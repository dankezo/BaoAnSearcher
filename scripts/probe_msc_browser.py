"""Test the site's ordinary guest search; no stored login or CAPTCHA tokens."""
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'test zone' / 'procurement'))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from browser_update import COMPONENT, URL, payload, same_search
from core import TENDER_API
from scripts.cloud_browser import open_browser


def main():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as runtime:
        browser = open_browser(runtime)
        # Keep the remote service's default browser context for this diagnostic.
        page = browser.contexts[0].new_page() if browser.contexts else browser.new_page(locale='vi-VN')
        failures = []
        page.on('requestfailed', lambda request: failures.append({
            'path': urlsplit(request.url).path, 'failure': request.failure,
        }))
        try:
            response = page.goto(URL,
                                 wait_until='domcontentloaded', timeout=45000)
            print(json.dumps({'document_status': response.status if response else None,
                              'title': page.title()}, ensure_ascii=True), flush=True)
            if page.title() == 'Error':
                print(json.dumps({'error_page': page.locator('body').inner_text()[:500]}, ensure_ascii=True), flush=True)
                return
            page.wait_for_function('Boolean(' + COMPONENT + ')', timeout=30000)
            body = payload(0)
            def matches(response):
                try:
                    return response.url.split('?')[0] == TENDER_API and same_search(response.request.post_data_json, body)
                except Exception:
                    return False
            with page.expect_response(matches, timeout=30000) as pending:
                # The normal website handler obtains its own reCAPTCHA v3 result.
                page.evaluate('(p)=>{const v=' + COMPONENT + ';v.axiosSearch(p)}', body)
            response = pending.value
            data = response.json() if response.status == 200 else {}
            result_page = data.get('page', {}) if isinstance(data, dict) else {}
            print(json.dumps({'search_status': response.status,
                              'medicine_rows': len(result_page.get('content') or []),
                              'total_pages': result_page.get('totalPages')}, ensure_ascii=True), flush=True)
        except Exception as exc:
            print(json.dumps({'error': type(exc).__name__, 'request_failures': failures[-8:]}, ensure_ascii=True), flush=True)
        finally:
            browser.close()


if __name__ == '__main__':
    main()
