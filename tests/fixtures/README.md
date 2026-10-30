# tests/fixtures

Shared fixture data. `event-discovery/` holds captured event-discovery source
samples used by deterministic tests: crescent_city_calendar_listing.html,
crescent_city_get_list.json, dnaca_arts_calendar.html, library_programs.html.
`uscg/` holds the 2026-09-08 NAVCEN captures (bnm-d11-listing.html,
bnm-message-68955277.html). `permits/`, `dredging/`, `fuel/`, `pacfin/` and
`ais/` hold the 2026-09-28 captures for the five expansion monitors:
mygov-permits-module-pi.html (MyGov public portal Permits module),
ccharbor-sitemap.xml (Harbor District sitemap),
eia-weekly-ca-retail-gasoline.html (EIA weekly CA retail gasoline page),
reports-dashboard.html (PacFIN APEX dashboard with its embedded report tree)
and digitraffic-ais-locations.json (first 50 features of the keyless open-AIS
FeatureCollection feed, real data, bounded subset).

## Capture sanitation

The MyGov permit fixture is a sanitized derivative of the recorded public HTML.
An unrelated browser-map credential assignment was removed after shared-repository
secret-scanning alert #1. Catalog markup and parsed permit entries are unchanged;
the sanitized file must not be described as byte-identical to the upstream capture.
Historical copies and credential validity/restrictions require separate review.

The offline fixture publication guard rejects raw Google-key-shaped values and
reports file/line locators only. It is deliberately narrow, not a general secret
scanner or a claim that a credential has been revoked. Use placeholders rather
than real credentials in captured or generated examples.
