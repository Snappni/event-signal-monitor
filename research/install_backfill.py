"""Atomically merge a verified, isolated backfill, preserving live observations and switches."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time
from filelock import FileLock
from engine import database, _run, atomic_json


def install(root, data, backup):
    root=Path(root).resolve();data=Path(data).resolve();backup=Path(backup).resolve()
    checks=json.loads((data/'verification.json').read_text(encoding='utf-8'))
    context=json.loads((data/'context-verification.json').read_text(encoding='utf-8'))
    if not checks.get('passed') or len(checks.get('symbols',[]))!=19 or not context.get('passed'):
        raise ValueError('backfill_verification_required')
    # Cooperate with the Node launcher as well as the Python single-writer lock.
    node_lock=root/'worker.lock'
    for attempt in range(120):
        try:
            with node_lock.open('x',encoding='utf-8') as f:json.dump({'pid':os.getpid()},f)
            break
        except FileExistsError:
            if attempt==119:raise TimeoutError('research_worker_busy')
            time.sleep(1)
    try:
        with FileLock(str(root/'engine.run.lock'),timeout=120):
            db=database(root/'research.sqlite3');backup.parent.mkdir(parents=True,exist_ok=True)
            if backup.exists():raise ValueError('backup_already_exists_choose_new_path')
            saved=sqlite3.connect(backup);db.backup(saved);saved.close()
            stage=data/'stage/factor-research/research.sqlite3';aux=data/'context.sqlite3'
            for file in [stage,aux]:
                check=sqlite3.connect(f'file:{file.as_posix()}?mode=ro',uri=True)
                if check.execute('pragma integrity_check').fetchone()[0]!='ok':raise ValueError('staged_integrity_failed')
                check.close()
            protected={name:hashlib.sha256((root.parent/name).read_bytes()).hexdigest() for name in ['factor-library-config.json','paper-account.json','account.json']}
            db.execute('ATTACH DATABASE ? AS incoming',(str(stage),));db.execute('ATTACH DATABASE ? AS context',(str(aux),))
            before=db.execute('SELECT count(*) FROM observations').fetchone()[0]
            db.execute('BEGIN IMMEDIATE')
            conflicts=db.execute('''SELECT count(*) FROM observations o JOIN incoming.observations n ON o.t=n.t AND o.symbol=n.symbol
                WHERE o.source=n.source AND (o.price!=n.price OR o.features!=n.features)''').fetchone()[0]
            if conflicts:raise ValueError('immutable_history_conflict')
            db.execute('INSERT OR IGNORE INTO observations SELECT * FROM incoming.observations')
            # Never attach a historical label to an existing live observation at the same key.
            db.execute('''INSERT OR IGNORE INTO labels SELECT l.* FROM incoming.labels l
                JOIN observations o ON o.t=l.t AND o.symbol=l.symbol WHERE o.source='historical_binance_um_v2' ''')
            db.execute('INSERT OR IGNORE INTO gaps SELECT * FROM incoming.gaps')
            db.execute('INSERT OR IGNORE INTO funding_settlements SELECT * FROM context.funding_settlements')
            for table in ['historical_events','historical_factor_snapshots','historical_depth']:
                schema=db.execute("SELECT sql FROM context.sqlite_master WHERE type='table' AND name=?",(table,)).fetchone()[0]
                db.execute(schema.replace('CREATE TABLE ','CREATE TABLE IF NOT EXISTS ',1))
                db.execute(f'INSERT OR IGNORE INTO {table} SELECT * FROM context.{table}')
            summary={'schema':1,'source':'historical_binance_um_v2','installedAt':int(time.time()),
                'rawRoot':str(data),'start':checks['start'],'fineStart':checks['fineStart'],'endExclusive':checks['endExclusive'],
                'symbols':19,'addedObservations':db.execute('SELECT count(*) FROM observations').fetchone()[0]-before,
                'corrections':sum(s['checks']['previousArchive']['conflicts'] for s in checks['symbols']),
                'context':context['counts'],'newsStatuses':context['newsStatuses'],'backup':str(backup),
                'limitations':['current-symbol universe, not survivorship-free','older 15m data has no 5m labels',
                    'OKX funding retention limits its feature history','percent depth is not L1/L5; old snapshots are evidence only',
                    'news requires timestamp-complete, versioned replay; no fabricated neutral values',
                    'closed-bar historical features and live mixed venue inputs require forward confirmation']}
            db.execute('INSERT OR REPLACE INTO meta VALUES(?,?)',('historical_backfill',json.dumps(summary)))
            db.commit();db.close();atomic_json(root/'backfill.json',summary)
            print(json.dumps({'installed':summary}),flush=True)
            report=_run(root,force=True)
            after={name:hashlib.sha256((root.parent/name).read_bytes()).hexdigest() for name in protected}
            result={'passed':True,'counts':report['counts'],
                'factorsWithIc':sum(bool(f.get('metrics')) for f in report['factors'].values()),
                'publication':report['publication'],'protectedFilesUnchanged':protected==after,
                'protectedHashesBefore':protected,'protectedHashesAfter':after}
            atomic_json(data/'installed-verification.json',result);print(json.dumps(result),flush=True)
            return result
    finally:
        if node_lock.exists() and json.loads(node_lock.read_text(encoding='utf-8')).get('pid')==os.getpid():node_lock.unlink()


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--data',required=True);p.add_argument('--backup',required=True)
    args=p.parse_args();install(args.root,args.data,args.backup)
