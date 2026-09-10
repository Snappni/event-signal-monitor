"""Download verifiable public history; never manufacture missing market observations."""
import argparse
import csv
import gzip
import hashlib
import io
import json
import math
import subprocess
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from pathlib import Path

BASE = 'https://data.binance.vision/data/futures/um'


def fetch(url, path):
    path = Path(path)
    if path.exists():
        return path.read_bytes()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.part')
    result = subprocess.run(['curl.exe' if __import__('os').name == 'nt' else 'curl',
        '--fail', '--silent', '--show-error', '--location', '--retry', '3',
        '--connect-timeout', '15', '--max-time', '90', url, '-o', str(tmp)], capture_output=True)
    if result.returncode:
        raise RuntimeError(f'download_failed: {url}: {result.stderr.decode(errors="replace")}')
    tmp.replace(path)
    return path.read_bytes()


def archive(url, root, evidence):
    name = url.removeprefix(BASE + '/').replace('/', '__')
    data = fetch(url, root/'raw'/name)
    expected = fetch(url+'.CHECKSUM', root/'raw'/(name+'.CHECKSUM')).decode().split()[0]
    actual = hashlib.sha256(data).hexdigest()
    if actual != expected:
        raise ValueError('official_checksum_mismatch: '+url)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        if z.testzip() is not None or len(z.namelist()) != 1:
            raise ValueError('archive_crc_or_members: '+url)
        rows = list(csv.reader(io.StringIO(z.read(z.namelist()[0]).decode('utf-8-sig'))))
    if rows and not rows[0][0].isdigit():
        rows.pop(0)
    evidence.append({'url': url, 'sha256': actual, 'rows': len(rows), 'checksumVerified': True})
    return rows


def validate_candles(rows, minutes, start, end):
    step = minutes*60000
    previous = None
    for r in rows:
        t = int(r[0]); o,h,l,c,v = map(float,r[1:6])
        if t % step or int(r[6]) != t+step-1:
            raise ValueError('candle_timestamp_or_interval')
        if not all(math.isfinite(x) for x in [o,h,l,c,v]) or min(o,h,l,c)<=0 or v<0 or not l<=min(o,c)<=max(o,c)<=h:
            raise ValueError('invalid_ohlcv')
        if previous is not None and t != previous+step:
            raise ValueError(f'missing_or_duplicate_candle: {previous}->{t}')
        if float(r[7])<0 or float(r[9])<0 or float(r[9])>v+1e-7 or float(r[10])>float(r[7])+1e-5:
            raise ValueError('invalid_taker_volume')
        previous=t
    if not rows or int(rows[0][0]) != start or int(rows[-1][0])+step != end:
        raise ValueError('incomplete_requested_window')


def same_row(a,b):
    return all(math.isclose(float(a[i]),float(b[i]),rel_tol=1e-10,abs_tol=1e-7) for i in range(11))


def write_gz(path, value):
    path.parent.mkdir(parents=True,exist_ok=True)
    with gzip.open(path,'wt',encoding='utf-8') as f:
        json.dump(value,f,separators=(',',':'))


def collect_symbol(symbol, root, previous, start, fine_start, end):
    evidence=[]; result={'symbol':symbol,'checks':{}}
    output={}
    for interval, since in [('15m',start),('1m',fine_start)]:
        rows=[]; day=since
        while day<end:
            next_month=(day.replace(day=28)+timedelta(days=4)).replace(day=1)
            if day.day==1 and next_month<=end:
                period=day.strftime('%Y-%m'); kind='monthly'; following=next_month
            else:
                period=day.strftime('%Y-%m-%d');kind='daily';following=day+timedelta(days=1)
            url=f'{BASE}/{kind}/klines/{symbol}/{interval}/{symbol}-{interval}-{period}.zip'
            rows.extend(archive(url,root,evidence));day=following
        validate_candles(rows,int(interval[:-1]),int(since.timestamp()*1000),int(end.timestamp()*1000))
        output[interval]=rows
        result['checks'][interval]={'rows':len(rows),'start':since.isoformat(),'endExclusive':end.isoformat()}
    # Check EVERY fine candle aggregation against the independently published 15m archive.
    coarse={int(r[0]):r for r in output['15m']}; matched=0
    for i in range(0,len(output['1m']),15):
        group=output['1m'][i:i+15]
        r=[group[0][0],group[0][1],max(float(x[2]) for x in group),min(float(x[3]) for x in group),
            group[-1][4],sum(float(x[5]) for x in group),group[-1][6],sum(float(x[7]) for x in group),
            sum(int(x[8]) for x in group),sum(float(x[9]) for x in group),sum(float(x[10]) for x in group)]
        if not same_row(r,coarse[int(r[0])]):
            raise ValueError(f'1m_15m_disagreement: {symbol} {r[0]}')
        matched+=1
    result['checks']['crossResolutionMatched']=matched
    prior=json.load(gzip.open(previous/f'{symbol}.json.gz','rt',encoding='utf-8'))
    overlap=[r for r in prior['klines'] if int(r[0]) in coarse]
    conflicts=[int(r[0]) for r in overlap if not same_row(r,coarse[int(r[0])])]
    corrections=[]
    for t in conflicts:
        url=f'https://fapi.binance.com/fapi/v1/klines?symbol={symbol}&interval=15m&startTime={t}&limit=1'
        raw=fetch(url,root/'raw'/f'{symbol}-candle-recheck-{t}.json')
        check=json.loads(raw)
        if not isinstance(check,list) or not check or not same_row(check[0],coarse[t]):
            raise ValueError(f'unresolved_archive_rest_disagreement: {symbol} {t}')
        corrections.append({'t':t,'old':next(r for r in overlap if int(r[0])==t),'verifiedClosed':coarse[t],
            'restUrl':url,'restSha256':hashlib.sha256(raw).hexdigest(),
            'atOldTail':t==int(prior['klines'][-1][0]),'resolution':'closed_official_archive_matches_rest; original_preserved'})
    result['checks']['previousArchive']={'overlap':len(overlap),'conflicts':len(conflicts),'corrections':corrections}
    # Funding archives have exact settlement times/rates; preserve exchange identity.
    funding=[];day=start
    while day.month!=end.month or day.year!=end.year:
        period=day.strftime('%Y-%m')
        rows=archive(f'{BASE}/monthly/fundingRate/{symbol}/{symbol}-fundingRate-{period}.zip',root,evidence)
        funding.extend({'fundingTime':int(r[0]),'fundingIntervalHours':int(r[1]),'fundingRate':float(r[2])} for r in rows)
        day=(day.replace(day=28)+timedelta(days=4)).replace(day=1)
    # REST supplies mark prices used at settlement and the unfinished archive month.
    rates=[];cursor=int(start.timestamp()*1000);last=int(end.timestamp()*1000)
    while cursor<last:
        url=f'https://fapi.binance.com/fapi/v1/fundingRate?symbol={symbol}&startTime={cursor}&endTime={last-1}&limit=1000'
        raw=fetch(url,root/'raw'/f'{symbol}-funding-rest-{cursor}-{last}.json')
        page=json.loads(raw)
        if not isinstance(page,list):raise ValueError('funding_rest_response')
        evidence.append({'url':url,'sha256':hashlib.sha256(raw).hexdigest(),'rows':len(page),'transport':'https_rest'})
        if not page:break
        rates.extend(page);cursor=int(page[-1]['fundingTime'])+1
    rest={int(r['fundingTime'])//1000:r for r in rates}
    for row in funding:
        other=rest.get(row['fundingTime']//1000)
        if not other or not math.isclose(row['fundingRate'],float(other['fundingRate']),abs_tol=1e-12):
            raise ValueError(f'funding_archive_rest_disagreement: {symbol} {row["fundingTime"]}')
    if len(rest)!=len(rates) or any(not math.isfinite(float(r['fundingRate'])) for r in rates):
        raise ValueError('invalid_funding_history')
    result['checks']['binanceFunding']={'rows':len(rates),'archiveRestMatches':len(funding),'markPrices':sum(float(r.get('markPrice') or 0)>0 for r in rates)}
    # OKX is the live factor's actual funding source. Public API retention is finite.
    okx=[];before=None;inst=symbol.replace('USDT','-USDT-SWAP')
    for page_no in range(60):
        url=f'https://www.okx.com/api/v5/public/funding-rate-history?instId={inst}&limit=100'+(f'&after={before}' if before else '')
        raw=fetch(url,root/'raw'/f'{symbol}-okx-funding-{before or "latest"}.json');page=json.loads(raw)
        if page.get('code')!='0':raise ValueError(f'okx_response: {symbol} {page.get("code")}')
        data=page['data'];evidence.append({'url':url,'sha256':hashlib.sha256(raw).hexdigest(),'rows':len(data),'transport':'https_rest'})
        if not data:break
        okx.extend(data);following=min(int(x['fundingTime']) for x in data)
        if before is not None and following>=before:raise ValueError('okx_pagination_not_advancing')
        before=following
        if before<int(fine_start.timestamp()*1000)-7*86400000:break
        time.sleep(.4)
    okx=sorted({int(r['fundingTime']):r for r in okx}.values(),key=lambda r:int(r['fundingTime']))
    result['checks']['okxFunding']={'rows':len(okx),'first':int(okx[0]['fundingTime']) if okx else None,'last':int(okx[-1]['fundingTime']) if okx else None}
    for interval,rows in output.items():
        write_gz(root/interval/f'{symbol}.json.gz',{'symbol':symbol,'venue':'binance_um','interval':interval,
            'klines':rows,'okxFunding':okx,'funding':rates,'verified':True,'provenance':evidence})
    result['provenance']=evidence
    (root/'audits').mkdir(exist_ok=True)
    (root/'audits'/f'{symbol}.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    return {k:v for k,v in result.items() if k!='provenance'}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--previous',required=True)
    p.add_argument('--start',default='2025-09-01');p.add_argument('--fine-start',default='2026-06-01');p.add_argument('--end',default='2026-09-06')
    a=p.parse_args();root=Path(a.root);root.mkdir(parents=True,exist_ok=True);previous=Path(a.previous)
    date=lambda v:datetime.fromisoformat(v).replace(tzinfo=timezone.utc)
    summaries=[];failures=[]
    with ThreadPoolExecutor(max_workers=4) as pool:
        jobs={pool.submit(collect_symbol,f.stem.split('.')[0],root,previous,date(a.start),date(a.fine_start),date(a.end)):f for f in sorted(previous.glob('*.json.gz'))}
        for job in as_completed(jobs):
            try: result=job.result();summaries.append(result);print(json.dumps(result),flush=True)
            except Exception as e:failures.append({'file':jobs[job].name,'error':str(e)});print(json.dumps(failures[-1]),flush=True)
    report={'passed':not failures,'generatedAt':datetime.now(timezone.utc).isoformat(),'start':a.start,'fineStart':a.fine_start,'endExclusive':a.end,'symbols':summaries,'failures':failures,
        'universePolicy':'current configured 19 symbols, not survivorship-free whole market','newsPolicy':'original recorded availability only','orderBookPolicy':'no reconstruction of L1/L5 or 30-second flows from OHLCV'}
    (root/'verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    raise SystemExit(bool(failures))
