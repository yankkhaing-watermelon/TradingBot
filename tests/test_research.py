import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import gmail_sync
from research import Archive


def report():
    return {'schema_version':'1.0','market':'BURSA','report_date':'2026-09-18',
        'generated_at':'2026-09-18T20:00:00+08:00','coverage_start':'2026-09-17T20:00:00+08:00',
        'coverage_end':'2026-09-18T20:00:00+08:00','summary':['TEST DATA ONLY'], 'coverage_gaps':[],
        'items':[{'id':'test-1','stock_codes':['0286'],'company_names':['Test company'],
        'category':'test','headline':'Synthetic test record','facts':['Not real market research'],
        'analysis':['Test interpretation'],'catalysts':[],'risks':[],
        'sources':[{'url':'https://example.com/test','title':'Test fixture','published_at':None}],
        'verification_status':'synthetic'}]}


class Tests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.db=Archive(Path(self.temp.name)/'test.db')
    def tearDown(self): self.temp.cleanup()
    def ingest(self, r): return self.db.ingest(json.dumps(r).encode())
    def test_duplicates_and_leading_zero(self):
        self.assertEqual(self.ingest(report())['added'],1)
        self.assertEqual(self.ingest(report())['status'],'duplicate')
        snap=self.db.snapshot()
        self.assertEqual(len(snap['reports']),1)
        self.assertEqual(snap['items'][0]['stock_codes'],['0286'])
    def test_revisions_preserved(self):
        self.ingest(report()); revised=report();revised['items'][0]['facts']=['Revised fact']
        self.assertEqual(self.ingest(revised)['added'],1)
        self.assertEqual(len(self.db.snapshot()['items']),2)
    def test_invalid_batch_is_atomic(self):
        r=report();bad=copy.deepcopy(r['items'][0]);bad['id']='bad';bad['sources'][0]['url']='javascript:alert(1)';r['items'].append(bad)
        with self.assertRaises(ValueError):self.ingest(r)
        self.assertEqual(self.db.snapshot()['reports'],[])
    def test_invalid_code_and_schema(self):
        for key,value in [('schema_version','9'),('stock_codes',[286])]:
            r=report()
            if key=='stock_codes':r['items'][0][key]=value
            else:r[key]=value
            with self.assertRaises(ValueError):self.ingest(r)
    def test_coverage_timezone_required(self):
        r=report();r['coverage_start']='2026-09-17T20:00:00'
        with self.assertRaises(ValueError):self.ingest(r)
    def test_gmail_nested_attachment(self):
        import base64
        attachment=base64.urlsafe_b64encode(json.dumps(report()).encode()).decode().rstrip('=')
        replies=[{'access_token':'test'},{'emailAddress':'investmalaysia2025@gmail.com'},
            {'messages':[{'id':'message1'}]},
            {'payload':{'parts':[{'parts':[{'filename':'report.json','body':{'attachmentId':'attachment1'}}]}]}},
            {'data':attachment}]
        with patch.dict('os.environ',{'GMAIL_CLIENT_ID':'test','GMAIL_CLIENT_SECRET':'test','GMAIL_REFRESH_TOKEN':'test'}),patch('gmail_sync.request',side_effect=replies):
            result=gmail_sync.sync(self.db)
        self.assertEqual(result['results'][0]['added'],1)
        self.assertEqual(result['errors'],[])
    def test_wrong_gmail_account(self):
        with patch.dict('os.environ',{'GMAIL_CLIENT_ID':'test','GMAIL_CLIENT_SECRET':'test','GMAIL_REFRESH_TOKEN':'test'}),patch('gmail_sync.request',side_effect=[{'access_token':'test'},{'emailAddress':'wrong@example.com'}]):
            with self.assertRaises(ValueError):gmail_sync.sync(self.db)
        self.assertEqual(self.db.snapshot()['reports'],[])

if __name__=='__main__': unittest.main()
