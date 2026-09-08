import json, tempfile, unittest, time
from pathlib import Path
import numpy as np
import pandas as pd
from engine import database, ingest, settle, interval_stats, purged_split, evaluate, qlib_experiment, config_digest, govern, load_panel, cross_sectional_ic

class ResearchTests(unittest.TestCase):
    def test_vectorized_ic_matches_full_alphalens_with_ties(self):
        from alphalens.performance import factor_information_coefficient
        rng=np.random.default_rng(123)
        idx=pd.MultiIndex.from_product([pd.date_range('2025-01-01',periods=200,freq='h',tz='UTC'),list('ABCDEFGH')],names=['date','asset'])
        p=pd.DataFrame({'factor':rng.integers(-2,3,len(idx)).astype(float),'60m':rng.integers(-3,4,len(idx)).astype(float)},index=idx)
        p.loc[idx[:8],'60m']=0
        actual=cross_sectional_ic(p,'60m')
        expected=factor_information_coefficient(p.assign(group='universe'),by_group=True)['60m'].droplevel('group').dropna()
        self.assertEqual(list(actual.index),list(expected.index));np.testing.assert_allclose(actual,expected,rtol=1e-12,atol=1e-12)
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.db=database(Path(self.tmp.name)/'test.sqlite3')
    def tearDown(self):
        self.db.close(); self.tmp.cleanup()
    def test_labels_without_trades_and_missing(self):
        t=1700000000
        packet={'schema':1,'frames':[{'t':t+i*60,'symbols':{'BTC':{'price':100+i,'values':{'null':None,'zero':0},'cost':.0016}}} for i in range(17)]}
        self.assertEqual(ingest(self.db,packet),17); self.assertEqual(ingest(self.db,packet),0)
        settle(self.db)
        row=self.db.execute('SELECT end_t,gross,trainable FROM labels WHERE t=? AND horizon=5',(t,)).fetchone()
        self.assertEqual(row[0],t+300); self.assertAlmostEqual(row[1],.05); self.assertEqual(row[2],1)
        values=json.loads(self.db.execute('SELECT features FROM observations LIMIT 1').fetchone()[0]);self.assertIsNone(values['null']);self.assertEqual(values['zero'],0)
        self.assertEqual(self.db.execute('SELECT count(*) FROM labels WHERE horizon=240').fetchone()[0],0)
    def test_outage(self):
        t=1700000000
        ingest(self.db,{'schema':1,'frames':[{'t':t+i*60,'symbols':{'BTC':{'price':100,'values':{}}}} for i in [0,1,9,10]]})
        settle(self.db)
        self.assertEqual(self.db.execute('SELECT reason FROM labels WHERE t=? AND horizon=5',(t,)).fetchone()[0],'service_gap')
    def test_backfill_price_ticks_and_funding(self):
        t=1700000000
        frames=[{'t':t+i*60,'symbols':{'BTC':{'price':100+i,'values':{'x':1} if i==0 else {}}}} for i in range(17)]
        packet={'schema':1,'source':'historical_binance_um_v2','frames':frames}
        self.assertEqual(ingest(self.db,packet),17);self.assertEqual(ingest(self.db,packet),0)
        self.db.executemany('INSERT INTO funding_settlements VALUES(?,?,?,?,?)',[
            ('binance_um','BTC',t,.01,100),('binance_um','BTC',t+120,.001,102),
            ('binance_um','BTC',t+400,.03,100),('okx','BTC',t+120,.04,100)])
        self.db.commit();settle(self.db)
        self.assertEqual(self.db.execute('SELECT count(*) FROM labels').fetchone()[0],2)
        p=load_panel(self.db,5);self.assertAlmostEqual(p._funding.iloc[0],.00102)
        self.assertAlmostEqual(p._return.iloc[0],.05)
    def test_independence_and_split(self):
        stats=interval_stats([1,-1]*7);self.assertLessEqual(stats['nEff'],14)
        idx=pd.MultiIndex.from_product([range(30),['A','B']]); p=pd.DataFrame({'_end':np.repeat(np.arange(30)+4,2)},index=idx)
        a,b,c=purged_split(p);self.assertLess(a._end.max(),b.index.get_level_values(0).min());self.assertLess(b._end.max(),c.index.get_level_values(0).min())
        self.assertFalse(set(a.index.get_level_values(0))&set(b.index.get_level_values(0)))
    def test_publication_probation_clustering_and_manual_disable(self):
        now=int(time.time()); catalog=[{'id':f,'role':'direction'} for f in ['a','b']]
        config={'enabled':True,'autoGovernanceEnabled':True,'decisionInfluence':.25,
            'factorSettings':{f:{'enabled':True,'useInDecision':False,'archived':False,'weight':1} for f in ['a','b']}}
        for i in range(110):
            t=now-(111-i)*3600
            for j in range(4):
                x=(j-1.5)/2
                self.db.execute('INSERT INTO observations VALUES(?,?,?,?,?,?)',(t,str(j),100,json.dumps({'a':x,'b':x}),'live',.0016))
                self.db.execute('INSERT INTO labels VALUES(?,?,?,?,?,?,?,?)',(t,str(j),60,t+3600,x*.04,.0016,1,'ok'))
        self.db.execute('INSERT INTO observations VALUES(?,?,?,?,?,?)',(now,'0',100,'{}','live',.0016));self.db.commit()
        metric={'nEff':400,'samples':400,'q':.001,'sameSignFolds':4,'test':{'lower95':.1},'ev':{'lower95':.001},'coverage':1,'asOf':now,'orientation':1}
        metrics={f:{'metrics':{'60':dict(metric)}} for f in ['a','b']}
        states,pub=govern(self.db,catalog,config,metrics,{},True)
        self.assertIsNone(pub['version']);self.assertEqual(states['a']['reason'],'probation_48h_100_labels')
        for state in states.values(): state['eligibleSince']=now-120*3600
        states,pub=govern(self.db,catalog,config,metrics,{'governance':states},True)
        self.assertEqual(pub['status'],'published');self.assertEqual(len(pub['factors']),1)
        self.assertGreaterEqual(states['a']['forwardBatches'],100)
        config['factorSettings']['a']['enabled']=False;config['factorSettings']['b']['enabled']=False
        _,stopped=govern(self.db,catalog,config,metrics,{'governance':states,'publication':pub},True)
        self.assertEqual(stopped['factors'],[])
        config['decisionMode']='manual'
        manual_states,manual_pub=govern(self.db,catalog,config,metrics,{'governance':states,'publication':pub},True)
        self.assertEqual(manual_states,{})
        self.assertEqual(manual_pub['factors'],[])
        self.assertEqual(manual_pub['reason'],'manual_mode')

    def test_real_alphalens_and_qlib(self):
        rng=np.random.default_rng(17)
        for i in range(100):
            t=1700000000+i*3600
            for j in range(8):
                x=float(rng.uniform(-1,1)); y=.02*x+float(rng.normal(0,.0001))
                self.db.execute('INSERT INTO observations VALUES(?,?,?,?,?,?)',(t,str(j),100,json.dumps({'signal':x,'inverse':-x,'constant':1}), 'fixture',.0016))
                self.db.execute('INSERT INTO labels VALUES(?,?,?,?,?,?,?,?)',(t,str(j),60,t+3600,y,.0016,1,'ok'))
        self.db.commit()
        metrics=evaluate(self.db,[{'id':x,'role':'direction'} for x in ['signal','inverse','constant']])
        self.assertGreater(metrics['signal']['metrics']['60']['meanIc'],.95)
        self.assertEqual(metrics['signal']['metrics']['60']['samples'],100)
        self.assertLess(metrics['inverse']['metrics']['60']['meanIc'],-.95)
        self.assertEqual(metrics['constant']['metrics'],{})
        self.assertLessEqual(metrics['signal']['metrics']['60']['nEff'],100)
        model=qlib_experiment(self.db);self.assertEqual(model['backend'],'qlib');self.assertGreater(model['rankIc'],.95);self.assertFalse(model['publicationAllowed'])

if __name__=='__main__': unittest.main(verbosity=2)
