"""Restore original event evidence and venue-specific funding/depth without relabeling proxies."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
import gzip
import hashlib
import json
from pathlib import Path
import sqlite3
import unicodedata
from backfill_history import archive
from engine import database


def epoch(value):
    try:
        if isinstance(value,(int,float)):return value/1000 if value>1e11 else float(value)
        return datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()
    except (ValueError,TypeError,AttributeError):return None


def restore_events(db, paths, exported):
    expected={}
    manifest=exported/'metadata/SHA256SUMS.txt'
    if manifest.exists():
        for line in manifest.read_text(encoding='utf-8').splitlines():
            sha,name=line.split(None,1);expected[str((exported/name.strip()).resolve())]=sha
    evidence=[]
    def walk(value, observed, file):
        if isinstance(value,list):
            for item in value:walk(item,observed,file)
        elif isinstance(value,dict):
            observed=epoch(value.get('generatedAt') or value.get('capturedAt') or value.get('updatedAt')) or observed
            if value.get('title') and value.get('source'):
                text=' '.join(unicodedata.normalize('NFKC',str(value.get('title',''))).split()).lower()
                normalized=hashlib.sha256((text+'|'+str(value.get('url',''))).encode()).hexdigest()
                source=str(value['source']); key=hashlib.sha256((source+'|'+normalized).encode()).hexdigest()
                occurred=epoch(value.get('occurredAt') or value.get('occurred_at') or value.get('publishedAt'))
                fetched=epoch(value.get('fetchedAt') or value.get('fetched_at') or value.get('receivedAt'))
                available=max(occurred or 0,fetched or 0) if occurred and fetched else None
                reason='raw_only_requires_versioned_news_replay' if available and (not observed or available<=observed+60) else 'quarantine_missing_or_invalid_event_time'
                db.execute('INSERT OR IGNORE INTO historical_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(
                    key,str(value.get('id') or 'derived:'+key),occurred,fetched,normalized,source,value.get('language'),
                    value.get('cluster_id') or value.get('storyId'),available,observed,reason,str(file),json.dumps(value,ensure_ascii=False),None))
            for key,child in value.items():
                if isinstance(child,(dict,list)):walk(child,observed,file)
    for file in paths:
        raw=file.read_bytes();sha=hashlib.sha256(raw).hexdigest();known=expected.get(str(file.resolve()))
        if str(file.resolve()).startswith(str(exported.resolve())) and known!=sha:
            raise ValueError('export_manifest_mismatch: '+str(file))
        evidence.append({'path':str(file.resolve()),'sha256':sha,'originalManifestVerified':known==sha})
        if '.jsonl' in file.name:
            # JSON strings may contain U+2028; only physical LF separates JSONL records.
            for line in raw.decode('utf-8-sig').split('\n'):
                if line.strip():walk(json.loads(line),None,file)
        else:
            obj=json.loads(raw.decode('utf-8-sig'));walk(obj,None,file)
            if file.name=='factor-library-status.json':
                # Old transformed snapshots retain their old version and stay out of current IC.
                for frame in obj.get('pendingFrames',[]):
                    t=epoch(frame.get('capturedAt'))
                    if not t:continue
                    for symbol,values in frame.get('values',{}).items():
                        db.execute('INSERT OR IGNORE INTO historical_factor_snapshots VALUES(?,?,?,?,?)',
                            (t,symbol,str(obj.get('version')),json.dumps(values),str(file)))
        db.commit()
    return evidence


def depth_day(root,symbol,day):
    evidence=[];date=day.strftime('%Y-%m-%d')
    url=f'https://data.binance.vision/data/futures/um/daily/bookDepth/{symbol}/{symbol}-bookDepth-{date}.zip'
    rows=archive(url,root,evidence);groups={};last=-1
    for r in rows:
        t=epoch(r[0]+'+00:00');pct,qty,quote=map(float,r[1:4])
        if not t or not day.timestamp()<=t<(day+timedelta(days=1)).timestamp() or t<last or min(qty,quote)<0:
            raise ValueError('invalid_depth_row: '+url)
        last=t;levels=groups.setdefault(t,{})
        if pct in levels:raise ValueError('duplicate_depth_level')
        levels[pct]=[qty,quote]
    for levels in groups.values():
        for side in (-1,1):
            quotes=[x[1][1] for x in sorted(levels.items(),key=lambda x:abs(x[0])) if x[0]*side>0]
            if any(b+1e-6<a for a,b in zip(quotes,quotes[1:])):raise ValueError('nonmonotonic_depth')
    # Full snapshots stay in checksummed ZIPs. SQL keeps hourly as-of samples, not synthetic L1/L5.
    samples={}
    for t,levels in groups.items():samples.setdefault(int(t)//3600,(t,json.dumps(levels)))
    return symbol,list(samples.values()),{**evidence[0],'snapshots':len(groups),'hourlySamples':len(samples),'semantic':'cumulative percentage depth; NOT price-level order book'}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--database',required=True);p.add_argument('--export',required=True);p.add_argument('--live',required=True)
    a=p.parse_args();root=Path(a.root);exported=Path(a.export);live=Path(a.live);db=database(a.database)
    db.executescript('''CREATE TABLE IF NOT EXISTS historical_events(
        record_id TEXT PRIMARY KEY,event_id TEXT,occurred_at REAL,fetched_at REAL,normalized_hash TEXT,source TEXT,
        language TEXT,cluster_id TEXT,available_at REAL,observed_at REAL,status TEXT,source_file TEXT,payload TEXT,replay_version TEXT);
        CREATE TABLE IF NOT EXISTS historical_factor_snapshots(t REAL,symbol TEXT,version TEXT,features TEXT,source_file TEXT,PRIMARY KEY(t,symbol,version));
        CREATE TABLE IF NOT EXISTS historical_depth(t REAL,symbol TEXT,levels TEXT,source_url TEXT,PRIMARY KEY(t,symbol));''')
    symbols=[]
    for f in sorted((root/'15m').glob('*.json.gz')):
        d=json.load(gzip.open(f,'rt',encoding='utf-8'));symbols.append(d['symbol'])
        for venue,rows in [('binance_um',d['funding']),('okx',d['okxFunding'])]:
            for r in rows:
                mark=float(r.get('markPrice') or 0) or None
                if venue=='binance_um' and mark is None:raise ValueError('missing_settlement_mark')
                db.execute('INSERT OR IGNORE INTO funding_settlements VALUES(?,?,?,?,?)',(venue,d['symbol'],int(r['fundingTime'])/1000,float(r['fundingRate']),mark))
    db.commit()
    paths=[]
    for folder in [exported/'runtime',live]:
        paths.extend(folder/n for n in ['state.json','latest-report.json','factor-library-status.json','paper-account.json'] if (folder/n).exists())
        paths.extend(sorted((folder/'trade-history').glob('*.jsonl')))
        paths.extend(sorted(folder.glob('decision-events.jsonl')))
    source_evidence=restore_events(db,paths,exported)
    depth_evidence=[];failures=[];end=datetime(2026,9,6,tzinfo=timezone.utc)
    with ThreadPoolExecutor(max_workers=4) as pool:
        jobs=[pool.submit(depth_day,root,s,end-timedelta(days=d)) for s in symbols for d in range(1,8)]
        for job in as_completed(jobs):
            try:
                symbol,samples,evidence=job.result();depth_evidence.append(evidence)
                db.executemany('INSERT OR IGNORE INTO historical_depth VALUES(?,?,?,?)',[(t,symbol,v,evidence['url']) for t,v in samples]);db.commit()
            except Exception as e:failures.append(str(e))
    report={'passed':not failures,'sourceFiles':source_evidence,'depthArchives':depth_evidence,'failures':failures,
        'counts':{table:db.execute('SELECT count(*) FROM '+table).fetchone()[0] for table in ['funding_settlements','historical_events','historical_factor_snapshots','historical_depth']},
        'newsStatuses':dict(db.execute('SELECT status,count(*) FROM historical_events GROUP BY status')),
        'policy':'Original news and old factor snapshots are retained as evidence, not silently pooled into current IC. Percent-depth archives do not reconstruct L1/L5 or cancellation flow.'}
    (root/'context-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8');db.close()
    print(json.dumps({k:v for k,v in report.items() if k not in ['sourceFiles','depthArchives']}));raise SystemExit(bool(failures))
