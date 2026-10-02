"""Tender metric drill-down predicates, evaluated before pagination."""
from datetime import datetime


def _date(raw):
    try:
        return datetime.fromisoformat(str(raw or '')[:19])
    except ValueError:
        return None


def matches_quick(item, filters, now=None):
    quick = filters.get('metricQuick')
    if not quick:
        return True
    now = now or datetime.now()
    months = int(filters.get('metricMonths') or 12)
    months = months if months in (3, 6, 12) else 12
    index = now.year * 12 + now.month - months
    start = datetime(index // 12, index % 12 + 1, 1)
    pub, close = _date(item.get('published')), _date(item.get('close_date'))
    if pub and not start <= pub <= now:
        return False
    code = str(item.get('status_code') or '').strip().upper()
    opened = not code and (close is None or close >= now)
    if quick == 'open_all':
        return opened
    if quick == 'new_72h':
        return opened and pub is not None and 0 <= (now - pub).total_seconds() < 72 * 3600
    if quick == 'closing_7d':
        return opened and close is not None and 0 <= (close - now).total_seconds() < 7 * 86400
    if quick == 'reviewing':
        return code == 'DXT' or (not code and close is not None and close < now)
    if quick in ('match_exact', 'match_near'):
        return opened and item.get('baoan_match') == quick.removeprefix('match_')
    return True
