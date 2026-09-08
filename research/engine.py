"""Causal, account-independent research worker. SQLite is the only label writer."""
import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import sqlite3
import time
import threading
from datetime import datetime, timezone

os.environ.setdefault("MPLBACKEND", "Agg")
os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("MLFLOW_DISABLE_AGENT_HINT", "1")
os.environ.setdefault("JULIA_NUM_THREADS", "2")
local_julia=Path(__file__).resolve().parent.parent/'.runtime/julia-1.12.7/bin/julia.exe'
if os.name=='nt' and local_julia.exists():
    os.environ.setdefault('PYTHON_JULIAPKG_EXE',str(local_julia))
import numpy as np
import pandas as pd
from alphalens.performance import factor_information_coefficient
from arch.bootstrap import StationaryBootstrap
from filelock import FileLock
from scipy.stats import norm
from statsmodels.stats.multitest import multipletests

HORIZONS = (5, 15, 60, 240)
POLICY = "causal_research_v1"


class TaskProgress:
    def __init__(self, root):
        self.path=Path(root)/'progress.json'
        self.value={'taskId':os.environ.get('FACTOR_RESEARCH_TASK_ID'),'phase':'starting'}
        self.lock=threading.Lock();self.stop=threading.Event()
        self.last_write=0
        self.thread=threading.Thread(target=self.beat,daemon=True)
    def __call__(self, phase, completed=None, total=None, detail=None):
        if not self.value['taskId']:return
        with self.lock:
            changed=phase!=self.value['phase']
            self.value.update(phase=phase,completed=completed,total=total,detail=detail)
            if changed or time.monotonic()-self.last_write>=.25:self.flush()
    def flush(self):
        self.value['heartbeatAt']=datetime.now(timezone.utc).isoformat()
        # Windows readers may briefly hold the destination; telemetry must not fail research.
        for _ in range(5):
            try:
                atomic_json(self.path,self.value)
                self.last_write=time.monotonic()
                break
            except PermissionError:time.sleep(.02)
    def beat(self):
        while not self.stop.wait(5):
            if self.value['taskId']:
                with self.lock:self.flush()
    def __enter__(self):
        self('starting');self.thread.start();return self
    def __exit__(self,*args):
        self.stop.set();self.thread.join(timeout=6)


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    os.replace(tmp, path)


def finite(value):
    return isinstance(value, (int, float)) and math.isfinite(value)


def database(path):
    db = sqlite3.connect(path, timeout=20)
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript('''
      CREATE TABLE IF NOT EXISTS observations(
        t INTEGER, symbol TEXT, price REAL, features TEXT, source TEXT, cost REAL,
        PRIMARY KEY(t,symbol));
      CREATE TABLE IF NOT EXISTS labels(
        t INTEGER, symbol TEXT, horizon INTEGER, end_t INTEGER, gross REAL,
        cost REAL, trainable INTEGER, reason TEXT, PRIMARY KEY(t,symbol,horizon));
      CREATE TABLE IF NOT EXISTS gaps(start_t INTEGER, end_t INTEGER, source TEXT,
        PRIMARY KEY(start_t,end_t,source));
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS funding_settlements(
        venue TEXT, symbol TEXT, t REAL, rate REAL, mark_price REAL,
        PRIMARY KEY(venue,symbol,t));
      CREATE INDEX IF NOT EXISTS labels_horizon ON labels(horizon,t);
      CREATE INDEX IF NOT EXISTS observation_symbol ON observations(symbol,source,t);
    ''')
    return db


def ingest(db, packet):
    if packet.get("schema") != 1:
        raise ValueError("packet_schema_mismatch")
    source = packet.get("source", "live")
    last = db.execute("SELECT max(t) FROM observations WHERE source=?", (source,)).fetchone()[0]
    added = 0
    for frame in sorted(packet.get("frames", []), key=lambda x: x["t"]):
        t = int(frame["t"])
        if t > int(time.time()) + 60:
            raise ValueError("future_observation_rejected")
        interval = max(60, int(frame.get("intervalSeconds", 60)))
        if last and t > last + interval * 2:
            db.execute("INSERT OR IGNORE INTO gaps VALUES(?,?,?)", (last, t, source))
        last = max(last or t, t)
        for symbol, point in frame.get("symbols", {}).items():
            price = point.get("price")
            if not finite(price) or price <= 0:
                continue
            values = {k: (float(v) if finite(v) else None) for k, v in point.get("values", {}).items()}
            # Insert once: later edits never overwrite a historical decision feature.
            result = db.execute("INSERT OR IGNORE INTO observations VALUES(?,?,?,?,?,?)",
                (t, symbol, price, json.dumps(values), source, max(0, float(point.get("cost", 0.0016)))))
            added += result.rowcount
    db.commit()
    return added


def settle(db, tolerance=90):
    """Use only prices at/after maturity, never late prices as an on-time label."""
    last = db.execute("SELECT max(t) FROM observations").fetchone()[0]
    if last is None:
        return 0
    added = 0
    for h in HORIZONS:
        rows = db.execute('''SELECT o.t,o.symbol,o.price,o.cost,o.source FROM observations o
          LEFT JOIN labels l ON l.t=o.t AND l.symbol=o.symbol AND l.horizon=?
          WHERE l.t IS NULL AND o.t+?<=? AND (o.source NOT LIKE 'historical_%' OR o.features!='{}')
          ORDER BY o.t''', (h, h*60, last)).fetchall()
        for t, symbol, price, cost, source in rows:
            due = t + h*60
            end = db.execute('''SELECT t,price FROM observations WHERE symbol=? AND source=?
                AND t>=? AND t<=? ORDER BY t LIMIT 1''', (symbol, source, due, due+tolerance)).fetchone()
            if end is None and last < due+tolerance:
                continue
            gap = db.execute('''SELECT 1 FROM gaps WHERE source=? AND start_t<? AND end_t>? LIMIT 1''',
                (source, due, t)).fetchone()
            reason = "service_gap" if gap else "missing_maturity_price" if end is None else "ok"
            db.execute("INSERT OR IGNORE INTO labels VALUES(?,?,?,?,?,?,?,?)", (
                t, symbol, h, end[0] if end else due, end[1]/price-1 if end else None,
                cost, int(reason == "ok"), reason))
            added += 1
    db.commit()
    return added


def interval_stats(values, block=4):
    x = np.asarray(values, dtype=float)
    x = x[np.isfinite(x)]
    if len(x) < 2:
        return {"samples": len(x), "nEff": len(x), "mean": float(x.mean()) if len(x) else None,
                "lower95": None, "upper95": None, "p": 1.0}
    rho = float(np.corrcoef(x[:-1], x[1:])[0, 1]) if len(x)>3 and x[:-1].std()>1e-12 and x[1:].std()>1e-12 else 0
    rho = max(0, min(.95, rho if math.isfinite(rho) else 0))
    neff = min(len(x), len(x)*(1-rho)/(1+rho))
    # Same time block carries all assets after cross-sectional aggregation.
    bs = StationaryBootstrap(min(max(1, block), len(x)), x, seed=17)
    ci = bs.conf_int(np.mean, reps=300, size=.95, method="percentile")[:, 0]
    se = float(x.std(ddof=1)/math.sqrt(max(neff, 1)))
    z = abs(float(x.mean()))/max(se, 1e-12)
    return {"samples": len(x), "nEff": float(neff), "mean": float(x.mean()),
            "lower95": float(min(ci[0], x.mean()-1.96*se)),
            "upper95": float(max(ci[1], x.mean()+1.96*se)), "p": float(2*norm.sf(z))}


def load_panel(db, horizon, limit_days=730):
    latest = db.execute("SELECT max(t) FROM observations").fetchone()[0] or 0
    rows = db.execute('''SELECT o.t,o.symbol,o.features,l.gross,l.cost,l.end_t,o.source,
        CASE WHEN o.source LIKE 'historical_binance_%' THEN COALESCE((SELECT sum(f.rate*f.mark_price/o.price)
          FROM funding_settlements f WHERE f.venue='binance_um' AND f.symbol=o.symbol
          AND f.t>o.t AND f.t<=l.end_t),0) ELSE 0 END FROM observations o
        JOIN labels l ON o.t=l.t AND o.symbol=l.symbol
        WHERE l.horizon=? AND l.trainable=1 AND o.features!='{}' AND o.t>=? ORDER BY o.t,o.symbol''',
        (horizon, latest-limit_days*86400)).fetchall()
    if not rows:
        return pd.DataFrame()
    panel = pd.DataFrame([{**json.loads(v), "t": t, "symbol": symbol,
        "_return": gross, "_cost": cost, "_end": end, "_source": source,
        "_funding": funding} for t, symbol, v, gross, cost, end, source, funding in rows])
    return panel.set_index(["t", "symbol"]).sort_index()


def purged_split(panel):
    times = panel.index.get_level_values(0).unique().sort_values()
    if len(times)<12:
        return [panel.iloc[:0]]*3
    a, b = int(times[int(len(times)*.6)]), int(times[int(len(times)*.8)])
    t = panel.index.get_level_values(0)
    return [panel[(t<a)&(panel._end<a)], panel[(t>=a)&(t<b)&(panel._end<b)], panel[t>=b]]


def cross_sectional_ic(indexed, return_column):
    """Vectorized Spearman, including ties; Alphalens checks deterministic time slices."""
    ranked=indexed[['factor',return_column]].groupby(level='date').rank(method='average')
    centered=ranked-ranked.groupby(level='date').transform('mean')
    x,y=centered['factor'],centered[return_column]
    denominator=np.sqrt((x*x).groupby(level='date').sum()*(y*y).groupby(level='date').sum())
    result=((x*y).groupby(level='date').sum()/denominator.replace(0,np.nan)).dropna()
    dates=indexed.index.get_level_values('date').unique()
    sample=dates[np.unique(np.linspace(0,len(dates)-1,min(8,len(dates)),dtype=int))]
    reference=factor_information_coefficient(indexed.loc[indexed.index.get_level_values('date').isin(sample)].assign(group='universe'),by_group=True)[return_column].droplevel('group').dropna()
    if not np.allclose(result.reindex(reference.index),reference,rtol=1e-12,atol=1e-12):
        raise ValueError('vectorized_ic_alphalens_disagreement')
    return result


def evaluate(db, catalog, progress=None):
    output = {item["id"]: {"metrics": {}, "role": item["role"]} for item in catalog}
    roles = {item["id"]: item["role"] for item in catalog}
    for hi,h in enumerate(HORIZONS):
        panel = load_panel(db, h)
        if panel.empty:
            continue
        for fi,fid in enumerate(roles):
            if progress:progress('evaluating_ic',hi*len(roles)+fi,len(roles)*len(HORIZONS),f'{fid} / {h}m')
            if fid not in panel:
                continue
            part = panel[[fid, "_return", "_cost", "_end", "_funding", "_source"]].replace([np.inf, -np.inf], np.nan).dropna()
            if part.empty:
                continue
            coverage=len(part)/len(panel)
            # Sample among available feature observations, not price-only maturity ticks.
            anchor=part.index.get_level_values(0)
            first=pd.Series(anchor,index=part.index).groupby(anchor//(h*60)).transform('min')
            part=part[anchor==first.to_numpy()]
            target = part._return if roles[fid] == "direction" else part._return.abs()
            return_column=f"{h}m"
            indexed = pd.DataFrame({"factor": part[fid], return_column: target})
            indexed.index = pd.MultiIndex.from_arrays([
                pd.to_datetime(indexed.index.get_level_values(0), unit="s", utc=True),
                indexed.index.get_level_values(1)], names=["date", "asset"])
            valid_times = indexed.groupby(level=0).factor.agg(["count", "nunique"])
            keep = valid_times[(valid_times['count']>=4)&(valid_times['nunique']>1)].index
            indexed = indexed[indexed.index.get_level_values(0).isin(keep)]
            if indexed.empty:
                continue
            # Reloaded's by_group=False calls asfreq(None), silently downsampling to days.
            # One explicit universe group preserves every actual intraday timestamp.
            ic = cross_sectional_ic(indexed,return_column)
            if ic.empty:
                continue
            stat = interval_stats(ic.values)
            train, validation, test = purged_split(part)
            train_times=pd.to_datetime(train.index.get_level_values(0).unique(),unit="s",utc=True)
            train_ic = ic[ic.index.isin(train_times)]
            orientation = 1 if train_ic.mean() >= 0 else -1
            fold_means = [float(x.mean()) if len(x) else None for x in np.array_split(ic.to_numpy(),4)]
            same_sign = sum(v is not None and v*orientation>0 for v in fold_means)
            net = pd.Series(dtype=float)
            if not test.empty and roles[fid] == "direction":
                signal = np.sign(test[fid])*orientation
                net = (signal*(test._return-test._funding)-test._cost).groupby(level=0).mean()
            ev = interval_stats(net.to_numpy())
            test_start = test.index.get_level_values(0).min() if not test.empty else None
            test_ic = ic[ic.index >= pd.to_datetime(test_start,unit="s",utc=True)] if test_start else ic.iloc[:0]
            test_stat = interval_stats(test_ic.values*orientation)
            series_ic = {}
            for symbol, g in part.groupby(level=1):
                y = g._return if roles[fid] == "direction" else g._return.abs()
                value = g[fid].corr(y,method="spearman") if len(g)>=8 and g[fid].nunique()>1 and y.nunique()>1 else None
                series_ic[symbol] = float(value) if value is not None and np.isfinite(value) else None
            output[fid]["metrics"][str(h)] = {**stat, "meanIc": stat["mean"],
                "horizonMinutes": h, "method": "alphalens_verified_vectorized_spearman+arch_stationary_bootstrap",
                "orientation": orientation, "foldMeans": fold_means, "sameSignFolds": same_sign,
                "test": test_stat, "ev": ev, "timeSeriesIc": series_ic,
                "coverage": coverage, "q": 1.0, "rollingIc": {str(days): float(ic[ic.index >= ic.index.max()-pd.Timedelta(days=days)].mean()) for days in (7,30,90)},
                "sourceRows": {str(k):int(v) for k,v in part._source.value_counts().items()},
                "target": "forward_return" if roles[fid]=="direction" else "absolute_forward_return",
                "values": [float(v) for v in ic.iloc[-90:]],
                "asOf": int(part._end.max()), "split": [len(x) for x in (train,validation,test)]}
        keys = [fid for fid,v in output.items() if str(h) in v["metrics"]]
        # Include all registered hypotheses, not just surviving candidates.
        pvalues = [output[fid]["metrics"].get(str(h),{}).get("test",{}).get("p",1) for fid in output]
        qs = dict(zip(output, multipletests(pvalues,method="fdr_bh")[1]))
        for fid in keys:
            output[fid]["metrics"][str(h)]["q"] = float(qs[fid])
    return output


def qlib_experiment(db):
    """Run a real Qlib DatasetH + model pipeline. Research only, no live promotion."""
    import qlib
    from qlib.data.dataset import DatasetH
    from qlib.data.dataset.handler import DataHandlerLP
    from qlib.contrib.model.linear import LinearModel
    from qlib.contrib.eva.alpha import calc_ic
    panel = load_panel(db,60)
    if panel.empty or len(panel.index.get_level_values(0).unique())<30:
        return {"status":"collecting", "reason":"insufficient_time_batches", "backend":"qlib"}
    splits = purged_split(panel)
    train = splits[0]
    cols = [c for c in panel if not c.startswith('_') and train[c].notna().mean()>=.95 and train[c].std()>1e-9]
    if not cols or any(s.empty for s in splits):
        return {"status":"collecting", "reason":"insufficient_feature_coverage", "backend":"qlib"}
    means=train[cols].mean(); scales=train[cols].std().clip(lower=1e-6)
    x=((panel[cols].fillna(means)-means)/scales).clip(-10,10)
    frame=pd.concat({"feature":x,"label":panel[["_return"]]},axis=1)
    frame.index=pd.MultiIndex.from_arrays([pd.to_datetime(frame.index.get_level_values(0),unit='s',utc=True).tz_localize(None),frame.index.get_level_values(1)],names=['datetime','instrument'])
    segments={name:(pd.to_datetime(s.index.get_level_values(0).min(),unit='s'),pd.to_datetime(s.index.get_level_values(0).max(),unit='s')) for name,s in zip(['train','valid','test'],splits)}
    # from_df uses StaticDataLoader: no remote provider, stock calendar, or future fill.
    dataset=DatasetH(handler=DataHandlerLP.from_df(frame),segments=segments)
    model=LinearModel(estimator='ridge',alpha=1.0)
    model.fit(dataset)
    pred=model.predict(dataset)
    labels=dataset.prepare('test',col_set='label').iloc[:,0]
    _,ric=calc_ic(pred,labels)
    return {"status":"evaluated_shadow", "backend":"qlib", "version":qlib.__version__,
            "features":cols, "samples":len(frame), "testSamples":len(labels),
            "rankIc":float(ric.mean()) if np.isfinite(ric.mean()) else None,
            "publicationAllowed":False,"reason":"requires_forward_shadow_and_portfolio_validation"}


def mine(db, outdir):
    panel=load_panel(db,60)
    if panel.empty:
        return {"status":"collecting", "reason":"no_mature_labels", "candidates":[]}
    train,_,_=purged_split(panel)
    cols=[c for c in train if not c.startswith('_') and train[c].notna().mean()>=.95 and train[c].std()>1e-9][:16]
    if len(cols)<2 or len(train)<100:
        return {"status":"collecting", "reason":"insufficient_training_data", "candidates":[]}
    train=train.dropna(subset=cols)
    x=train[cols].to_numpy(); y=train._return.to_numpy()
    # Time-series operators are precomputed inputs. Search never sees held-out rows.
    from pysr import PySRRegressor
    model=PySRRegressor(niterations=8,populations=4,population_size=20,tournament_selection_n=5,maxsize=15,maxdepth=5,
        binary_operators=['+','-','*'],unary_operators=['tanh'],
        parallelism='serial',deterministic=True,random_state=17,verbosity=0,progress=False,
        timeout_in_seconds=120,output_directory=str(outdir),run_id=str(int(time.time())))
    model.fit(x,y)
    candidates=[]
    for _,row in model.equations_.iterrows():
        expression=str(row['sympy_format'])
        version=hashlib.sha256((POLICY+expression+json.dumps(cols)).encode()).hexdigest()
        candidates.append({'id':'pysr_'+version[:16],'expression':expression,'version':version,'ast':expression_ast(row['sympy_format'],cols),
            'inputs':cols,'complexity':int(row['complexity']),'loss':float(row['loss']),
            'trainedUntil':int(train._end.max()),'status':'quarantine','useInDecision':False})
    return {'status':'complete','backend':'pysr','objective':'training_mse_then_independent_validation',
        'candidates':candidates,'automaticProductionPromotion':False}


def expression_ast(expr, columns):
    import sympy
    if expr.is_Number: return {'op':'constant','value':float(expr)}
    if expr.is_Symbol:
        index=int(str(expr).removeprefix('x'))
        return {'op':'feature','id':columns[index]}
    ops={sympy.Add:'add',sympy.Mul:'mul',sympy.tanh:'tanh',sympy.Pow:'pow'}
    if expr.func not in ops: raise ValueError('unsupported_mined_operator')
    return {'op':ops[expr.func],'args':[expression_ast(arg,columns) for arg in expr.args]}


def config_digest(config, catalog):
    settings=config['factorSettings']
    # JS JSON.stringify emits integral floats without a decimal point.
    def integer_if_whole(x):
        return int(x) if float(x).is_integer() else x
    data=[config['enabled'],config['autoGovernanceEnabled'],integer_if_whole(config['decisionInfluence']),
        [[d['id'],settings[d['id']]['enabled'],settings[d['id']]['useInDecision'],
          settings[d['id']]['archived'],integer_if_whole(settings[d['id']]['weight'])] for d in catalog if d['id'] in settings]]
    if config.get('decisionMode')=='manual':data.append('manual')
    return hashlib.sha256(json.dumps(data,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()


def govern(db,catalog,config,metrics,old,due):
    """One owner, daily basket writes; manual selection is a request, not a bypass."""
    now=int(time.time()); states=dict(old.get('governance',{})); prior=old.get('publication',{})
    digest=config_digest(config,catalog)
    if config.get('decisionMode')=='manual':
        return {},{'status':'shadow','version':None,'factors':[],'configHash':digest,'reason':'manual_mode'}
    if not due and prior.get('configHash')==digest:
        return states,prior
    candidates=[]
    for d in catalog:
        fid=d['id']; setting=config['factorSettings'].get(fid)
        if setting is None:
            states[fid]={'reason':'mined_quarantine','passed':False}
            continue
        m=metrics.get(fid,{}).get('metrics',{}).get('60',{})
        p=states.get(fid,{})
        requested=config['enabled'] and setting['enabled'] and not setting['archived'] and setting['weight']>0 and (setting['useInDecision'] or config['autoGovernanceEnabled'])
        eligible=d['role']=='direction' and not d.get('governanceOnly')
        passed=(eligible and m.get('nEff',0)>=200 and m.get('q',1)<=.05 and m.get('sameSignFolds',0)>=3
            and (m.get('test',{}).get('lower95') or 0)>0 and (m.get('ev',{}).get('lower95') or 0)>0 and m.get('coverage',0)>=.8)
        # Repeating an evaluation over unchanged observations is not new evidence.
        fresh=m.get('asOf',0)>p.get('asOf',0)
        invalid=0 if passed else p.get('invalidWindows',0)+(1 if fresh else 0)
        since=(p.get('eligibleSince') or now) if passed else None
        base=p.get('labelsAtEligibility',m.get('samples',0)) if since==p.get('eligibleSince') else m.get('samples',0)
        forward=0
        if since:
            forward=db.execute("""SELECT count(DISTINCT o.t/3600) FROM observations o JOIN labels l
                ON o.t=l.t AND o.symbol=l.symbol WHERE l.horizon=60 AND l.trainable=1
                AND o.source='live' AND o.t>=? AND json_extract(o.features,?) IS NOT NULL""",(since,'$.'+fid)).fetchone()[0]
        mature=passed and now-since>=48*3600 and forward>=100
        reason='research_only_role' if not eligible else 'not_requested' if not requested else 'collecting' if not m else 'validation_failed' if not passed else 'probation_48h_100_labels' if not mature else 'eligible'
        states[fid]={'reason':reason,'passed':bool(passed),'asOf':m.get('asOf',0),'eligibleSince':since,
            'labelsAtEligibility':base,'forwardBatches':forward,'invalidWindows':invalid,'samples':m.get('samples',0)}
        was=next((f for f in prior.get('factors',[]) if f['id']==fid),None)
        # Negative EV can stop immediately; other degradation requires two fresh windows.
        retained=was and (invalid<2 or now-prior.get('publishedAt',0)<48*3600) and (m.get('ev',{}).get('lower95') or 0)>=0
        if requested and eligible and (mature or retained):
            candidates.append({'id':fid,'orientation':m.get('orientation',1),'weight':setting['weight']})
    empty={'status':'shadow','version':None,'factors':[],'configHash':digest,'reason':'no_validated_basket'}
    if not candidates:
        return states,empty
    latest_live=db.execute("SELECT max(t) FROM observations WHERE source='live'").fetchone()[0] or 0
    if now-latest_live>180:
        return states,{**empty,'reason':'live_observation_stale'}
    panel=load_panel(db,60)
    train,_,test=purged_split(panel)
    # Connected components, not greedy pair deletion: all |rho| >= .85 edges unite.
    ids=[f['id'] for f in candidates if f['id'] in train]
    parent={fid:fid for fid in ids}
    def find(x):
        while parent[x]!=x:
            x=parent[x]
        return x
    corr=train[ids].corr(method='spearman')
    for i,a in enumerate(ids):
        for b in ids[i+1:]:
            if abs(corr.loc[a,b])>=.85: parent[find(b)]=find(a)
    reps={}
    # Choose representative on train coverage alone; held-out outcomes never rank members.
    for f in candidates:
        if f['id'] not in parent: continue
        cluster=find(f['id']); prior_rep=reps.get(cluster)
        if prior_rep is None or train[f['id']].notna().mean()>train[prior_rep['id']].notna().mean(): reps[cluster]=f
    factors=list(reps.values()); total=sum(f['weight'] for f in factors)
    if not total or test.empty: return states,empty
    for f in factors: f['weight']/=total
    test=test.dropna(subset=[f['id'] for f in factors])
    if test.empty: return states,empty
    score=sum(test[f['id']].clip(-1,1)*f['orientation']*f['weight'] for f in factors)
    # Equal-capital cross-sectional shadow basket; not a leveraged execution backtest.
    returns=(np.sign(score)*(test._return-test._funding)-test._cost).groupby(level=0).mean()
    times=returns.index.to_numpy(); selected=pd.Series(times,index=times).groupby(times//3600).transform('min')
    ev=interval_stats(returns[times==selected.to_numpy()].to_numpy())
    if (ev['lower95'] or 0)<=0: return states,{**empty,'reason':'basket_ev_failed','shadowBasketEv':ev}
    unchanged=prior.get('factors')==factors and prior.get('configHash')==digest
    if prior.get('status')=='published' and not unchanged and now-prior.get('publishedAt',0)<86400:
        # Never continue an old basket after a user disables a member or changes settings.
        return states,{**empty,'reason':'daily_write_limit'}
    version=prior.get('version') if unchanged else hashlib.sha256(json.dumps([digest,factors,now],sort_keys=True).encode()).hexdigest()[:16]
    return states,{'status':'published','version':version,'configHash':digest,'factors':factors,
        'publishedAt':prior.get('publishedAt',now) if unchanged else now,'expiresAt':now+7200,
        'shadowBasketEv':ev,'scope':'direction_allocation_only','entryRiskGates':'unchanged'}


def _run(root, force=False, mining=False, progress=None):
    root=Path(root);root.mkdir(parents=True,exist_ok=True)
    db=database(root/'research.sqlite3')
    catalog=json.loads((root/'catalog.json').read_text(encoding='utf-8'))
    config=json.loads((root/'config.json').read_text(encoding='utf-8'))
    added=0
    # Crash after commit, before unlink is harmless: primary keys are idempotent.
    packets=sorted((root/'inbox').glob('*.json'))
    for i,p in enumerate(packets):
        if progress:progress('ingesting',i,len(packets))
        packet=json.loads(p.read_text(encoding='utf-8'))
        added+=ingest(db,packet)
        p.unlink()
    if progress:progress('settling_labels')
    settled=settle(db)
    old_path=root/'report.json'
    old=json.loads(old_path.read_text(encoding='utf-8')) if old_path.exists() else {}
    due=force or time.time()-old.get('evaluatedAt',0)>=config.get('evaluationMinutes',60)*60
    metrics=evaluate(db,catalog,progress) if due else old.get('factors',{})
    if progress:progress('qlib_model' if due else 'reuse_evaluation')
    model=qlib_experiment(db) if due else old.get('model',{})
    mining_result=old.get('mining',{'status':'idle','candidates':[]})
    if mining:
        if progress:progress('mining_expressions')
        try:
            mining_result=mine(db,root/'mining')
        except Exception as error:
            mining_result={'status':'error','reason':str(error),'candidates':[]} 
        combined={c['id']:c for c in old.get('mining',{}).get('candidates',[])}
        combined.update({c['id']:c for c in mining_result.get('candidates',[])})
        mining_result['candidates']=list(combined.values())[-50:]
        mining_result['completedAt']=int(time.time())
    counts={'observations':db.execute('SELECT count(*) FROM observations').fetchone()[0],
        'timeBatches':db.execute('SELECT count(DISTINCT t) FROM observations').fetchone()[0],
        'matured':db.execute('SELECT count(*) FROM labels').fetchone()[0],
        'excluded':db.execute('SELECT count(*) FROM labels WHERE trainable=0').fetchone()[0],
        'gaps':db.execute('SELECT count(*) FROM gaps').fetchone()[0]}
    counts['featureObservations']=db.execute("SELECT count(*) FROM observations WHERE features!='{}'").fetchone()[0]
    label_inputs=db.execute("SELECT count(*) FROM observations WHERE source NOT LIKE 'historical_%' OR features!='{}'").fetchone()[0]
    counts['pending']=max(0,label_inputs*len(HORIZONS)-counts['matured'])
    backfill_row=db.execute("SELECT value FROM meta WHERE key='historical_backfill'").fetchone()
    if progress:progress('governance')
    governance, publication = govern(db,catalog,config,metrics,old,due)
    report={'schema':1,'engine':POLICY,'generatedAt':int(time.time()),
        'evaluatedAt':int(time.time()) if due else old.get('evaluatedAt'),
        'counts':counts,'factors':metrics,'model':model,'mining':mining_result,
        'components':{n:importlib.metadata.version(n) for n in ['pyqlib','alphalens-reloaded','arch','statsmodels','pysr']},
        'governance':governance,'publication':publication,
        'historicalBackfill':json.loads(backfill_row[0]) if backfill_row else None,
        'costPolicy':{'roundTrip':'per-observation fee/slippage estimate, not actual fills',
            'funding':'historical_binance: signed settled rate * settlement mark / entry; live funding not backfilled',
            'productionEntryEvGate':'unchanged'},
        'lastRun':{'ingested':added,'settled':settled}}
    if progress:progress('saving_report')
    atomic_json(old_path,report)
    db.close()
    if progress:progress('completed',1,1)
    return report


def run(root, force=False, mining=False, progress=None):
    Path(root).mkdir(parents=True,exist_ok=True)
    with FileLock(str(Path(root)/'engine.run.lock'),timeout=0):
        return _run(root,force,mining,progress)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--root',required=True)
    parser.add_argument('--evaluate',action='store_true')
    parser.add_argument('--mine',action='store_true')
    args=parser.parse_args()
    try:
        with TaskProgress(args.root) as progress:
            report=run(args.root,args.evaluate,args.mine,progress)
        print(json.dumps({'passed':True,'counts':report['counts'],'components':report['components']}))
    except Exception as error:
        atomic_json(Path(args.root)/'error.json',{'at':int(time.time()),'error':str(error)})
        raise
