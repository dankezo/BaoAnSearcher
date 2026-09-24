import argparse
from datetime import date,timedelta
from core import coverage,import_file,export_file
from sync import Downloader

def main():
    p=argparse.ArgumentParser(description='Loc thau thuoc tren may')
    p.add_argument('--download',action='store_true');p.add_argument('--from-date',default=(date.today()-timedelta(days=30)).isoformat())
    p.add_argument('--to-date',default=date.today().isoformat());p.add_argument('--refresh',action='store_true')
    p.add_argument('--import-file');p.add_argument('--export');p.add_argument('--kind',choices=['prices','tenders'],default='prices');p.add_argument('--status',action='store_true')
    args=p.parse_args()
    if args.import_file:print(import_file(args.import_file))
    if args.download:Downloader().run(args.from_date,args.to_date,args.refresh)
    if args.export:export_file(args.export,args.kind)
    if args.status:
        counts,slices,dates=coverage();print('COUNTS',counts,'DATES',dates)
        for row in slices: print(row['category'],row['date_from'],row['date_to'],row['status'],row['seen'],row['expected'])

if __name__=='__main__':main()
