import json
import os
from pathlib import Path
import tempfile
import unittest
from contextlib import closing
from unittest.mock import patch
import engine
from resource_budget import budget


class ServerDataTests(unittest.TestCase):
    def test_collecting_does_not_import_qlib_models(self):
        import builtins
        original_import=builtins.__import__
        def guarded_import(name,*args,**kwargs):
            if name=='qlib' or name.startswith('qlib.'):
                raise AssertionError('collecting_run_imported_qlib')
            return original_import(name,*args,**kwargs)
        # Both early exits must stay ahead of heavy imports, even if Qlib is cached.
        index=engine.pd.MultiIndex.from_product([range(40),['A','B']])
        missing=engine.pd.DataFrame({'x':float('nan'),'_end':[t+1 for t,_ in index]},index=index)
        for panel,reason in [(engine.pd.DataFrame(),'insufficient_time_batches'),
                             (missing,'insufficient_feature_coverage')]:
            with patch.object(engine,'load_panel',return_value=panel), \
                    patch.object(builtins,'__import__',side_effect=guarded_import):
                result=engine.qlib_experiment(None)
            self.assertEqual(result,{'status':'collecting','reason':reason,'backend':'qlib'})

    def test_bounded_settlement_resumes_without_duplicate_labels(self):
        with tempfile.TemporaryDirectory() as tmp, closing(engine.database(Path(tmp)/'research.sqlite3')) as db:
            frames=[{'t':1700000000+i*60,'symbols':{'A':{'price':100+i,'values':{'x':i}}}} for i in range(301)]
            engine.ingest(db, {'schema':1,'frames':frames})
            with patch.object(engine, 'budget', return_value={**budget(), 'labelsPerHorizon':10}):
                self.assertEqual(engine.settle(db),40)
                first=db.execute('SELECT count(*) FROM labels').fetchone()[0]
                self.assertEqual(engine.settle(db),40)
                self.assertEqual(db.execute('SELECT count(*) FROM labels').fetchone()[0], first+40)
            engine.settle(db)
            count=db.execute('SELECT count(*) FROM labels').fetchone()[0]
            self.assertEqual(engine.settle(db),0)
            self.assertEqual(count, sum(301-h for h in engine.HORIZONS))
            db.close()

    def test_window_keeps_whole_batches_and_source_data(self):
        with tempfile.TemporaryDirectory() as tmp, closing(engine.database(Path(tmp)/'research.sqlite3')) as db:
            for t in range(30):
                for symbol in 'ABCDEFGH':
                    db.execute('INSERT INTO observations VALUES(?,?,?,?,?,?)', (t*3600,symbol,100,'{"x":1}','live',.0016))
                    db.execute('INSERT INTO labels VALUES(?,?,?,?,?,?,?,?)', (t*3600,symbol,60,(t+1)*3600,.01,.0016,1,'ok'))
            db.commit()
            standard=engine.load_panel(db,60)
            with patch.object(engine,'budget',return_value={**budget(), 'panelDays':90,'panelRows':83}):
                limited=engine.load_panel(db,60)
            self.assertEqual(len(standard),240)
            self.assertEqual(len(limited),80)
            self.assertEqual(set(limited.groupby(level=0).size()),{8})
            self.assertEqual(limited.index.get_level_values(0).min(),20*3600)
            self.assertEqual(db.execute('SELECT count(*) FROM observations').fetchone()[0],240)
            self.assertEqual(len(engine.load_panel(db,60)),240)
            db.close()

    def test_low_profile_requires_supervisor_before_numerical_import(self):
        import subprocess, sys
        env={**os.environ,'FACTOR_RESEARCH_PROFILE':'server-low'}
        env.pop('FACTOR_RESEARCH_SUPERVISED',None)
        result=subprocess.run([sys.executable,'research/engine.py','--root','unused'],env=env,capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('server_research_requires_resource_supervisor',result.stderr)

    def test_long_horizon_anchors_precede_memory_cap(self):
        with tempfile.TemporaryDirectory() as tmp, closing(engine.database(Path(tmp)/'research.sqlite3')) as db:
            for minute in range(20*240):
                db.execute('INSERT INTO observations VALUES(?,?,?,?,?,?)', (minute*60,'A',100,'{"x":1}','live',.0016))
                db.execute('INSERT INTO labels VALUES(?,?,?,?,?,?,?,?)', (minute*60,'A',240,(minute+240)*60,.01,.0016,1,'ok'))
            db.commit()
            with patch.object(engine,'budget',return_value={**budget(),'panelDays':90,'panelRows':12}):
                panel=engine.load_panel(db,240)
            self.assertEqual(list(panel.index.get_level_values(0)),[i*240*60 for i in range(8,20)])


if __name__=='__main__': unittest.main(verbosity=2)
