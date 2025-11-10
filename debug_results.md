

Voy a ir exponiendo de ultimo a primero los modulos:

=========================================
1- módulo "futures-detail" (Detalle de un contrato de futuros) en https://robinhood.com/futures/MESZ25

Peticiones:

https://api.robinhood.com/markets/XASE/hours/2025-11-11/
fetch("https://api.robinhood.com/markets/XASE/hours/2025-11-11/", {
  "headers": {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "priority": "u=1, i",
    "sec-ch-ua": "\"Chromium\";v=\"141\", \"Not?A_Brand\";v=\"8\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "x-hyper-ex": "enabled",
    "x-robinhood-api-version": "1.431.4",
    "x-timezone-id": "America/New_York",
    "Referer": "https://robinhood.com/"
  },
  "body": null,
  "method": "GET"
});

{"date":"2025-11-11","is_open":true,"opens_at":"2025-11-11T14:30:00Z","closes_at":"2025-11-11T21:00:00Z","late_option_closes_at":"2025-11-11T21:15:00Z","extended_opens_at":"2025-11-11T12:00:00Z","extended_closes_at":"2025-11-12T01:00:00Z","all_day_opens_at":"2025-11-11T01:00:00Z","all_day_closes_at":"2025-11-12T01:00:00Z","previous_open_hours":"https:\/\/api.robinhood.com\/markets\/XASE\/hours\/2025-11-10\/","next_open_hours":"https:\/\/api.robinhood.com\/markets\/XASE\/hours\/2025-11-12\/","index_option_0dte_closes_at":"2025-11-11T21:00:00Z","index_option_non_0dte_closes_at":"2025-11-11T21:15:00Z","index_options_extended_hours":{"curb_opens_at":"2025-11-11T21:15:00Z","curb_closes_at":"2025-11-11T22:00:00Z"},"fx_opens_at":null,"fx_closes_at":null,"fx_is_open":false,"fx_next_open_hours":"2025-11-11T22:00:00Z"}

Request URL
https://api.robinhood.com/markets/XASE/hours/2025-11-11/
Request Method
GET
Status Code
200 OK
Remote Address
[64:ff9b::1240:9b67]:443
Referrer Policy
strict-origin-when-cross-origin
access-control-allow-credentials
true
access-control-allow-origin
https://robinhood.com
allow
GET, HEAD, OPTIONS
cache-control
max-age=60, private
content-language
en-us
content-length
820
content-type
application/json
date
Mon, 10 Nov 2025 07:25:30 GMT
server
envoy
trace-uuid
62fc3be9-69ea-493a-b367-dd4be50defa0
vary
Accept-Language, Origin, Accept-Encoding
via
1.1 df90bf385bebac012e714e0da4c539a6.cloudfront.net (CloudFront)
x-amz-cf-id
r9-4xyzQbStgrMw6BrpwzyvKiNtkSvt6dczRiJEewbA0kYnbhqgajA==
x-amz-cf-pop
ATL56-P2
x-cache
Miss from cloudfront
x-robinhood-api-version
brokeback/1.433.103-1626205674-gf267d7687be9f752a1a4d88d0dd1d6d8cbaeae77
:authority
api.robinhood.com
:method
GET
:path
/markets/XASE/hours/2025-11-11/
:scheme
https
accept
*/*
accept-encoding
gzip, deflate, br, zstd
accept-language
en-US,en;q=0.9
origin
https://robinhood.com
priority
u=1, i
referer
https://robinhood.com/
sec-ch-ua
"Chromium";v="141", "Not?A_Brand";v="8"
sec-ch-ua-mobile
?0
sec-ch-ua-platform
"Windows"
sec-fetch-dest
empty
sec-fetch-mode
cors
sec-fetch-site
same-site
user-agent
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36
x-hyper-ex
enabled
x-robinhood-api-version
1.431.4
x-timezone-id
America/New_York

Peticion 2:
https://api.robinhood.com/arsenal/v1/futures/contracts/symbol/MESZ25
fetch("https://api.robinhood.com/arsenal/v1/futures/contracts/symbol/MESZ25", {
  "headers": {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "authorization": "Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6IjIiLCJ0eXAiOiJKV1QifQ.eyJkY3QiOjE3NjI3NTkzNzIsImRldmljZV9oYXNoIjoiMTU1YTMxMTRiYTM1ZjI3NzMwODc5ZjRjYjljMDc2MjQiLCJleHAiOjE3NjUzMDA5MzQsImlzcyI6Imh0dHBzOi8vYXBpLnJvYmluaG9vZC5jb20iLCJsZXZlbDJfYWNjZXNzIjp0cnVlLCJtZXRhIjp7Im9pZCI6ImM4MlNIMFdaT3NhYk9YR1Ayc3hxY2ozNEZ4a3ZmbldSWkJLbEJqRlMiLCJvbiI6IlJvYmluaG9vZCJ9LCJvcHRpb25zIjp0cnVlLCJwb3MiOiJwIiwic2NvcGUiOiJpbnRlcm5hbCIsInNlcnZpY2VfcmVjb3JkcyI6W3siaGFsdGVkIjpmYWxzZSwic2VydmljZSI6ImNlcmVzX3VzIiwic2hhcmRfaWQiOjEsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoibnVtbXVzX3VzIiwic2hhcmRfaWQiOjIsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoiYnJva2ViYWNrX3VzIiwic2hhcmRfaWQiOjEzLCJzdGF0ZSI6ImF2YWlsYWJsZSJ9XSwic2xnIjoxLCJzbHMiOiJrTU5CcGdDaldRTmNiaURiSGtXS2M2NGhleDd5dzdUVWdVN2ZxY1VoRmdXcGNHUTQwVmgxbmU0ZE5CWHVzT3duOEU4d3J2eHBsbFRqU3lFVDU2bk9EZz09Iiwic3JtIjp7ImIiOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjEzfSwiYyI6eyJobCI6ZmFsc2UsInIiOiJ1cyIsInNpZCI6MX0sIm4iOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjJ9fSwidG9rZW4iOiJ3ZTlzNXpMSE5NclpkUDVRZHJxYWN6TFc0c3NmQmYiLCJ1c2VyX2lkIjoiYzY1ZmQyNTItYjg2NC00ZjBlLWE3NjctYmE0ZjJiZTMyZDcxIiwidXNlcl9vcmlnaW4iOiJVUyJ9.awcwoeCbk8VzAGSmcaF736sufIFjCXRefpKQb5noJIXwKuSIeO-YzALaam2HEAlIf1tMSckAZSsAttV-O0S1-w",
    "priority": "u=1, i",
    "rh-contract-protected": "true",
    "sec-ch-ua": "\"Chromium\";v=\"141\", \"Not?A_Brand\";v=\"8\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "x-timezone-id": "America/New_York",
    "Referer": "https://robinhood.com/"
  },
  "body": null,
  "method": "GET"
});

{"result":{"id":"c4021dc3-bc5c-4252-a5b9-209572a1cb78","productId":"f5e6b1cd-3d23-4add-8c51-385dd953a850","symbol":"/MESZ25:XCME","displaySymbol":"/MESZ25","description":"Micro E-mini S&P 500 Futures, Dec-25","multiplier":"5","expirationMmy":"202512","expiration":"2025-12-19","customerLastCloseDate":"2025-12-19","tradability":"FUTURES_TRADABILITY_TRADABLE","state":"FUTURES_STATE_ACTIVE","settlementStartTime":"08:30","firstTradeDate":"2024-05-01","settlementDate":"2025-12-19"}}

Request URL
https://api.robinhood.com/arsenal/v1/futures/contracts/symbol/MESZ25
Request Method
GET
Status Code
200 OK
Remote Address
[64:ff9b::1240:9b67]:443
Referrer Policy
strict-origin-when-cross-origin
access-control-allow-credentials
true
access-control-allow-origin
https://robinhood.com
content-length
481
content-type
application/json
date
Mon, 10 Nov 2025 07:25:30 GMT
grpc-message
grpc-status
0
server
envoy
via
1.1 df90bf385bebac012e714e0da4c539a6.cloudfront.net (CloudFront)
x-amz-cf-id
7NXHSnOsyE9EWcIH1a_DTGRJiboOo0WhtojeWR8ruuAt3Uan5wTX4A==
x-amz-cf-pop
ATL56-P2
x-cache
Miss from cloudfront
x-response-from
arsenal
:authority
api.robinhood.com
:method
GET
:path
/arsenal/v1/futures/contracts/symbol/MESZ25
:scheme
https
accept
*/*
accept-encoding
gzip, deflate, br, zstd
accept-language
en-US,en;q=0.9
authorization
Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6IjIiLCJ0eXAiOiJKV1QifQ.eyJkY3QiOjE3NjI3NTkzNzIsImRldmljZV9oYXNoIjoiMTU1YTMxMTRiYTM1ZjI3NzMwODc5ZjRjYjljMDc2MjQiLCJleHAiOjE3NjUzMDA5MzQsImlzcyI6Imh0dHBzOi8vYXBpLnJvYmluaG9vZC5jb20iLCJsZXZlbDJfYWNjZXNzIjp0cnVlLCJtZXRhIjp7Im9pZCI6ImM4MlNIMFdaT3NhYk9YR1Ayc3hxY2ozNEZ4a3ZmbldSWkJLbEJqRlMiLCJvbiI6IlJvYmluaG9vZCJ9LCJvcHRpb25zIjp0cnVlLCJwb3MiOiJwIiwic2NvcGUiOiJpbnRlcm5hbCIsInNlcnZpY2VfcmVjb3JkcyI6W3siaGFsdGVkIjpmYWxzZSwic2VydmljZSI6ImNlcmVzX3VzIiwic2hhcmRfaWQiOjEsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoibnVtbXVzX3VzIiwic2hhcmRfaWQiOjIsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoiYnJva2ViYWNrX3VzIiwic2hhcmRfaWQiOjEzLCJzdGF0ZSI6ImF2YWlsYWJsZSJ9XSwic2xnIjoxLCJzbHMiOiJrTU5CcGdDaldRTmNiaURiSGtXS2M2NGhleDd5dzdUVWdVN2ZxY1VoRmdXcGNHUTQwVmgxbmU0ZE5CWHVzT3duOEU4d3J2eHBsbFRqU3lFVDU2bk9EZz09Iiwic3JtIjp7ImIiOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjEzfSwiYyI6eyJobCI6ZmFsc2UsInIiOiJ1cyIsInNpZCI6MX0sIm4iOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjJ9fSwidG9rZW4iOiJ3ZTlzNXpMSE5NclpkUDVRZHJxYWN6TFc0c3NmQmYiLCJ1c2VyX2lkIjoiYzY1ZmQyNTItYjg2NC00ZjBlLWE3NjctYmE0ZjJiZTMyZDcxIiwidXNlcl9vcmlnaW4iOiJVUyJ9.awcwoeCbk8VzAGSmcaF736sufIFjCXRefpKQb5noJIXwKuSIeO-YzALaam2HEAlIf1tMSckAZSsAttV-O0S1-w
origin
https://robinhood.com
priority
u=1, i
referer
https://robinhood.com/
rh-contract-protected
true
sec-ch-ua
"Chromium";v="141", "Not?A_Brand";v="8"
sec-ch-ua-mobile
?0
sec-ch-ua-platform
"Windows"
sec-fetch-dest
empty
sec-fetch-mode
cors
sec-fetch-site
same-site
user-agent
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36
x-timezone-id
America/New_York


Peticion 3:
https://api.robinhood.com/marketdata/futures/quotes/v1/?ids=c4021dc3-bc5c-4252-a5b9-209572a1cb78

fetch("https://api.robinhood.com/marketdata/futures/quotes/v1/?ids=c4021dc3-bc5c-4252-a5b9-209572a1cb78", {
  "headers": {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "authorization": "Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6IjIiLCJ0eXAiOiJKV1QifQ.eyJkY3QiOjE3NjI3NTkzNzIsImRldmljZV9oYXNoIjoiMTU1YTMxMTRiYTM1ZjI3NzMwODc5ZjRjYjljMDc2MjQiLCJleHAiOjE3NjUzMDA5MzQsImlzcyI6Imh0dHBzOi8vYXBpLnJvYmluaG9vZC5jb20iLCJsZXZlbDJfYWNjZXNzIjp0cnVlLCJtZXRhIjp7Im9pZCI6ImM4MlNIMFdaT3NhYk9YR1Ayc3hxY2ozNEZ4a3ZmbldSWkJLbEJqRlMiLCJvbiI6IlJvYmluaG9vZCJ9LCJvcHRpb25zIjp0cnVlLCJwb3MiOiJwIiwic2NvcGUiOiJpbnRlcm5hbCIsInNlcnZpY2VfcmVjb3JkcyI6W3siaGFsdGVkIjpmYWxzZSwic2VydmljZSI6ImNlcmVzX3VzIiwic2hhcmRfaWQiOjEsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoibnVtbXVzX3VzIiwic2hhcmRfaWQiOjIsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoiYnJva2ViYWNrX3VzIiwic2hhcmRfaWQiOjEzLCJzdGF0ZSI6ImF2YWlsYWJsZSJ9XSwic2xnIjoxLCJzbHMiOiJrTU5CcGdDaldRTmNiaURiSGtXS2M2NGhleDd5dzdUVWdVN2ZxY1VoRmdXcGNHUTQwVmgxbmU0ZE5CWHVzT3duOEU4d3J2eHBsbFRqU3lFVDU2bk9EZz09Iiwic3JtIjp7ImIiOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjEzfSwiYyI6eyJobCI6ZmFsc2UsInIiOiJ1cyIsInNpZCI6MX0sIm4iOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjJ9fSwidG9rZW4iOiJ3ZTlzNXpMSE5NclpkUDVRZHJxYWN6TFc0c3NmQmYiLCJ1c2VyX2lkIjoiYzY1ZmQyNTItYjg2NC00ZjBlLWE3NjctYmE0ZjJiZTMyZDcxIiwidXNlcl9vcmlnaW4iOiJVUyJ9.awcwoeCbk8VzAGSmcaF736sufIFjCXRefpKQb5noJIXwKuSIeO-YzALaam2HEAlIf1tMSckAZSsAttV-O0S1-w",
    "priority": "u=1, i",
    "sec-ch-ua": "\"Chromium\";v=\"141\", \"Not?A_Brand\";v=\"8\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "x-hyper-ex": "enabled",
    "x-timezone-id": "America/New_York",
    "Referer": "https://robinhood.com/"
  },
  "body": null,
  "method": "GET"
});

{"status":"SUCCESS","data":[{"status":"SUCCESS","data":{"ask_price":"6801.5","ask_size":16,"ask_venue_timestamp":"2025-11-10T02:25:30.608-05:00","bid_price":"6801.25","bid_size":16,"bid_venue_timestamp":"2025-11-10T02:25:30.607-05:00","last_trade_price":"6801.5","last_trade_size":1,"last_trade_venue_timestamp":"2025-11-10T02:25:29.588-05:00","symbol":"/MESZ25:XCME","instrument_id":"c4021dc3-bc5c-4252-a5b9-209572a1cb78","state":"active","updated_at":"2025-11-10T02:25:30.608-05:00","out_of_band":false}}]}

Request URL
https://api.robinhood.com/marketdata/futures/quotes/v1/?ids=c4021dc3-bc5c-4252-a5b9-209572a1cb78
Request Method
GET
Status Code
200 OK
Remote Address
[64:ff9b::1240:9b67]:443
Referrer Policy
strict-origin-when-cross-origin
access-control-allow-credentials
true
access-control-allow-origin
https://robinhood.com
content-encoding
gzip
content-type
application/json
date
Mon, 10 Nov 2025 07:25:31 GMT
server
envoy
vary
Origin, Accept-Encoding
via
1.1 df90bf385bebac012e714e0da4c539a6.cloudfront.net (CloudFront)
x-amz-cf-id
1ATq5r4NFJ5JxSCQkytVGGsb6vhb4l6ICCvB8VWooEBzKsUZcLvLvA==
x-amz-cf-pop
ATL56-P2
x-cache
Miss from cloudfront
x-poll-interval
5
x-robinhood-md-num-instruments
1
:authority
api.robinhood.com
:method
GET
:path
/marketdata/futures/quotes/v1/?ids=c4021dc3-bc5c-4252-a5b9-209572a1cb78
:scheme
https
accept
*/*
accept-encoding
gzip, deflate, br, zstd
accept-language
en-US,en;q=0.9
authorization
Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6IjIiLCJ0eXAiOiJKV1QifQ.eyJkY3QiOjE3NjI3NTkzNzIsImRldmljZV9oYXNoIjoiMTU1YTMxMTRiYTM1ZjI3NzMwODc5ZjRjYjljMDc2MjQiLCJleHAiOjE3NjUzMDA5MzQsImlzcyI6Imh0dHBzOi8vYXBpLnJvYmluaG9vZC5jb20iLCJsZXZlbDJfYWNjZXNzIjp0cnVlLCJtZXRhIjp7Im9pZCI6ImM4MlNIMFdaT3NhYk9YR1Ayc3hxY2ozNEZ4a3ZmbldSWkJLbEJqRlMiLCJvbiI6IlJvYmluaG9vZCJ9LCJvcHRpb25zIjp0cnVlLCJwb3MiOiJwIiwic2NvcGUiOiJpbnRlcm5hbCIsInNlcnZpY2VfcmVjb3JkcyI6W3siaGFsdGVkIjpmYWxzZSwic2VydmljZSI6ImNlcmVzX3VzIiwic2hhcmRfaWQiOjEsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoibnVtbXVzX3VzIiwic2hhcmRfaWQiOjIsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoiYnJva2ViYWNrX3VzIiwic2hhcmRfaWQiOjEzLCJzdGF0ZSI6ImF2YWlsYWJsZSJ9XSwic2xnIjoxLCJzbHMiOiJrTU5CcGdDaldRTmNiaURiSGtXS2M2NGhleDd5dzdUVWdVN2ZxY1VoRmdXcGNHUTQwVmgxbmU0ZE5CWHVzT3duOEU4d3J2eHBsbFRqU3lFVDU2bk9EZz09Iiwic3JtIjp7ImIiOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjEzfSwiYyI6eyJobCI6ZmFsc2UsInIiOiJ1cyIsInNpZCI6MX0sIm4iOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjJ9fSwidG9rZW4iOiJ3ZTlzNXpMSE5NclpkUDVRZHJxYWN6TFc0c3NmQmYiLCJ1c2VyX2lkIjoiYzY1ZmQyNTItYjg2NC00ZjBlLWE3NjctYmE0ZjJiZTMyZDcxIiwidXNlcl9vcmlnaW4iOiJVUyJ9.awcwoeCbk8VzAGSmcaF736sufIFjCXRefpKQb5noJIXwKuSIeO-YzALaam2HEAlIf1tMSckAZSsAttV-O0S1-w
origin
https://robinhood.com
priority
u=1, i
referer
https://robinhood.com/
sec-ch-ua
"Chromium";v="141", "Not?A_Brand";v="8"
sec-ch-ua-mobile
?0
sec-ch-ua-platform
"Windows"
sec-fetch-dest
empty
sec-fetch-mode
cors
sec-fetch-site
same-site
user-agent
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36
x-hyper-ex
enabled
x-timezone-id
America/New_York


Peticion 5:
https://api.robinhood.com/marketdata/futures/fundamentals/v1/?ids=c4021dc3-bc5c-4252-a5b9-209572a1cb78

fetch("https://api.robinhood.com/marketdata/futures/fundamentals/v1/?ids=c4021dc3-bc5c-4252-a5b9-209572a1cb78", {
  "headers": {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "authorization": "Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6IjIiLCJ0eXAiOiJKV1QifQ.eyJkY3QiOjE3NjI3NTkzNzIsImRldmljZV9oYXNoIjoiMTU1YTMxMTRiYTM1ZjI3NzMwODc5ZjRjYjljMDc2MjQiLCJleHAiOjE3NjUzMDA5MzQsImlzcyI6Imh0dHBzOi8vYXBpLnJvYmluaG9vZC5jb20iLCJsZXZlbDJfYWNjZXNzIjp0cnVlLCJtZXRhIjp7Im9pZCI6ImM4MlNIMFdaT3NhYk9YR1Ayc3hxY2ozNEZ4a3ZmbldSWkJLbEJqRlMiLCJvbiI6IlJvYmluaG9vZCJ9LCJvcHRpb25zIjp0cnVlLCJwb3MiOiJwIiwic2NvcGUiOiJpbnRlcm5hbCIsInNlcnZpY2VfcmVjb3JkcyI6W3siaGFsdGVkIjpmYWxzZSwic2VydmljZSI6ImNlcmVzX3VzIiwic2hhcmRfaWQiOjEsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoibnVtbXVzX3VzIiwic2hhcmRfaWQiOjIsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoiYnJva2ViYWNrX3VzIiwic2hhcmRfaWQiOjEzLCJzdGF0ZSI6ImF2YWlsYWJsZSJ9XSwic2xnIjoxLCJzbHMiOiJrTU5CcGdDaldRTmNiaURiSGtXS2M2NGhleDd5dzdUVWdVN2ZxY1VoRmdXcGNHUTQwVmgxbmU0ZE5CWHVzT3duOEU4d3J2eHBsbFRqU3lFVDU2bk9EZz09Iiwic3JtIjp7ImIiOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjEzfSwiYyI6eyJobCI6ZmFsc2UsInIiOiJ1cyIsInNpZCI6MX0sIm4iOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjJ9fSwidG9rZW4iOiJ3ZTlzNXpMSE5NclpkUDVRZHJxYWN6TFc0c3NmQmYiLCJ1c2VyX2lkIjoiYzY1ZmQyNTItYjg2NC00ZjBlLWE3NjctYmE0ZjJiZTMyZDcxIiwidXNlcl9vcmlnaW4iOiJVUyJ9.awcwoeCbk8VzAGSmcaF736sufIFjCXRefpKQb5noJIXwKuSIeO-YzALaam2HEAlIf1tMSckAZSsAttV-O0S1-w",
    "priority": "u=1, i",
    "sec-ch-ua": "\"Chromium\";v=\"141\", \"Not?A_Brand\";v=\"8\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "x-hyper-ex": "enabled",
    "x-timezone-id": "America/New_York",
    "Referer": "https://robinhood.com/"
  },
  "body": null,
  "method": "GET"
});

{"status":"SUCCESS","data":[{"status":"SUCCESS","data":{"instrument_id":"c4021dc3-bc5c-4252-a5b9-209572a1cb78","open":"6786.25","high":"6807.25","low":"6772","volume":"146751","previous_close_price":"6753.75"}}]}

Request URL
https://api.robinhood.com/marketdata/futures/fundamentals/v1/?ids=c4021dc3-bc5c-4252-a5b9-209572a1cb78
Request Method
GET
Status Code
200 OK
Remote Address
[64:ff9b::1240:9b67]:443
Referrer Policy
strict-origin-when-cross-origin
access-control-allow-credentials
true
access-control-allow-origin
https://robinhood.com
content-encoding
gzip
content-type
application/json
date
Mon, 10 Nov 2025 07:25:31 GMT
server
envoy
vary
Origin, Accept-Encoding
via
1.1 df90bf385bebac012e714e0da4c539a6.cloudfront.net (CloudFront)
x-amz-cf-id
xI2eOyKPe1tMQ3_gO2ekYmhKrMKWHnDKL-3gyJYsRMXFd9LCo4OZkQ==
x-amz-cf-pop
ATL56-P2
x-cache
Miss from cloudfront
x-poll-interval
5
x-robinhood-md-num-instruments
1
:authority
api.robinhood.com
:method
GET
:path
/marketdata/futures/fundamentals/v1/?ids=c4021dc3-bc5c-4252-a5b9-209572a1cb78
:scheme
https
accept
*/*
accept-encoding
gzip, deflate, br, zstd
accept-language
en-US,en;q=0.9
authorization
Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6IjIiLCJ0eXAiOiJKV1QifQ.eyJkY3QiOjE3NjI3NTkzNzIsImRldmljZV9oYXNoIjoiMTU1YTMxMTRiYTM1ZjI3NzMwODc5ZjRjYjljMDc2MjQiLCJleHAiOjE3NjUzMDA5MzQsImlzcyI6Imh0dHBzOi8vYXBpLnJvYmluaG9vZC5jb20iLCJsZXZlbDJfYWNjZXNzIjp0cnVlLCJtZXRhIjp7Im9pZCI6ImM4MlNIMFdaT3NhYk9YR1Ayc3hxY2ozNEZ4a3ZmbldSWkJLbEJqRlMiLCJvbiI6IlJvYmluaG9vZCJ9LCJvcHRpb25zIjp0cnVlLCJwb3MiOiJwIiwic2NvcGUiOiJpbnRlcm5hbCIsInNlcnZpY2VfcmVjb3JkcyI6W3siaGFsdGVkIjpmYWxzZSwic2VydmljZSI6ImNlcmVzX3VzIiwic2hhcmRfaWQiOjEsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoibnVtbXVzX3VzIiwic2hhcmRfaWQiOjIsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoiYnJva2ViYWNrX3VzIiwic2hhcmRfaWQiOjEzLCJzdGF0ZSI6ImF2YWlsYWJsZSJ9XSwic2xnIjoxLCJzbHMiOiJrTU5CcGdDaldRTmNiaURiSGtXS2M2NGhleDd5dzdUVWdVN2ZxY1VoRmdXcGNHUTQwVmgxbmU0ZE5CWHVzT3duOEU4d3J2eHBsbFRqU3lFVDU2bk9EZz09Iiwic3JtIjp7ImIiOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjEzfSwiYyI6eyJobCI6ZmFsc2UsInIiOiJ1cyIsInNpZCI6MX0sIm4iOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjJ9fSwidG9rZW4iOiJ3ZTlzNXpMSE5NclpkUDVRZHJxYWN6TFc0c3NmQmYiLCJ1c2VyX2lkIjoiYzY1ZmQyNTItYjg2NC00ZjBlLWE3NjctYmE0ZjJiZTMyZDcxIiwidXNlcl9vcmlnaW4iOiJVUyJ9.awcwoeCbk8VzAGSmcaF736sufIFjCXRefpKQb5noJIXwKuSIeO-YzALaam2HEAlIf1tMSckAZSsAttV-O0S1-w
origin
https://robinhood.com
priority
u=1, i
referer
https://robinhood.com/
sec-ch-ua
"Chromium";v="141", "Not?A_Brand";v="8"
sec-ch-ua-mobile
?0
sec-ch-ua-platform
"Windows"
sec-fetch-dest
empty
sec-fetch-mode
cors
sec-fetch-site
same-site
user-agent
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36
x-hyper-ex
enabled
x-timezone-id
America/New_York


Eta es una peticion que se repite: https://api.robinhood.com/marketdata/futures/quotes/v1/?ids=c4021dc3-bc5c-4252-a5b9-209572a1cb78

fetch("https://api.robinhood.com/marketdata/futures/quotes/v1/?ids=c4021dc3-bc5c-4252-a5b9-209572a1cb78", {
  "headers": {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "authorization": "Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6IjIiLCJ0eXAiOiJKV1QifQ.eyJkY3QiOjE3NjI3NTkzNzIsImRldmljZV9oYXNoIjoiMTU1YTMxMTRiYTM1ZjI3NzMwODc5ZjRjYjljMDc2MjQiLCJleHAiOjE3NjUzMDA5MzQsImlzcyI6Imh0dHBzOi8vYXBpLnJvYmluaG9vZC5jb20iLCJsZXZlbDJfYWNjZXNzIjp0cnVlLCJtZXRhIjp7Im9pZCI6ImM4MlNIMFdaT3NhYk9YR1Ayc3hxY2ozNEZ4a3ZmbldSWkJLbEJqRlMiLCJvbiI6IlJvYmluaG9vZCJ9LCJvcHRpb25zIjp0cnVlLCJwb3MiOiJwIiwic2NvcGUiOiJpbnRlcm5hbCIsInNlcnZpY2VfcmVjb3JkcyI6W3siaGFsdGVkIjpmYWxzZSwic2VydmljZSI6ImNlcmVzX3VzIiwic2hhcmRfaWQiOjEsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoibnVtbXVzX3VzIiwic2hhcmRfaWQiOjIsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoiYnJva2ViYWNrX3VzIiwic2hhcmRfaWQiOjEzLCJzdGF0ZSI6ImF2YWlsYWJsZSJ9XSwic2xnIjoxLCJzbHMiOiJrTU5CcGdDaldRTmNiaURiSGtXS2M2NGhleDd5dzdUVWdVN2ZxY1VoRmdXcGNHUTQwVmgxbmU0ZE5CWHVzT3duOEU4d3J2eHBsbFRqU3lFVDU2bk9EZz09Iiwic3JtIjp7ImIiOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjEzfSwiYyI6eyJobCI6ZmFsc2UsInIiOiJ1cyIsInNpZCI6MX0sIm4iOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjJ9fSwidG9rZW4iOiJ3ZTlzNXpMSE5NclpkUDVRZHJxYWN6TFc0c3NmQmYiLCJ1c2VyX2lkIjoiYzY1ZmQyNTItYjg2NC00ZjBlLWE3NjctYmE0ZjJiZTMyZDcxIiwidXNlcl9vcmlnaW4iOiJVUyJ9.awcwoeCbk8VzAGSmcaF736sufIFjCXRefpKQb5noJIXwKuSIeO-YzALaam2HEAlIf1tMSckAZSsAttV-O0S1-w",
    "priority": "u=1, i",
    "sec-ch-ua": "\"Chromium\";v=\"141\", \"Not?A_Brand\";v=\"8\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "x-hyper-ex": "enabled",
    "x-timezone-id": "America/New_York",
    "Referer": "https://robinhood.com/"
  },
  "body": null,
  "method": "GET"
});

payload: ids=c4021dc3-bc5c-4252-a5b9-209572a1cb78

{"status":"SUCCESS","data":[{"status":"SUCCESS","data":{"ask_price":"6803.5","ask_size":18,"ask_venue_timestamp":"2025-11-10T02:41:24.178-05:00","bid_price":"6803.25","bid_size":15,"bid_venue_timestamp":"2025-11-10T02:41:24.433-05:00","last_trade_price":"6803.5","last_trade_size":1,"last_trade_venue_timestamp":"2025-11-10T02:41:23.616-05:00","symbol":"/MESZ25:XCME","instrument_id":"c4021dc3-bc5c-4252-a5b9-209572a1cb78","state":"active","updated_at":"2025-11-10T02:41:24.433-05:00","out_of_band":false}}]}

Request URL
https://api.robinhood.com/marketdata/futures/quotes/v1/?ids=c4021dc3-bc5c-4252-a5b9-209572a1cb78
Request Method
GET
Status Code
200 OK
Remote Address
[2607:7700:0:f::3455:4e09]:443
Referrer Policy
strict-origin-when-cross-origin
access-control-allow-credentials
true
access-control-allow-origin
https://robinhood.com
content-encoding
gzip
content-type
application/json
date
Mon, 10 Nov 2025 07:41:24 GMT
server
envoy
vary
Origin, Accept-Encoding
via
1.1 deb4333d946544018e87e421a8d3f79a.cloudfront.net (CloudFront)
x-amz-cf-id
DMFwfEH37E45u1D5l4wkN97uRl-1pNHmGIDF0dI_jb71f72j4y2EQw==
x-amz-cf-pop
MIA50-P6
x-cache
Miss from cloudfront
x-poll-interval
5
x-robinhood-md-num-instruments
1
:authority
api.robinhood.com
:method
GET
:path
/marketdata/futures/quotes/v1/?ids=c4021dc3-bc5c-4252-a5b9-209572a1cb78
:scheme
https
accept
*/*
accept-encoding
gzip, deflate, br, zstd
accept-language
en-US,en;q=0.9
authorization
Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6IjIiLCJ0eXAiOiJKV1QifQ.eyJkY3QiOjE3NjI3NTkzNzIsImRldmljZV9oYXNoIjoiMTU1YTMxMTRiYTM1ZjI3NzMwODc5ZjRjYjljMDc2MjQiLCJleHAiOjE3NjUzMDA5MzQsImlzcyI6Imh0dHBzOi8vYXBpLnJvYmluaG9vZC5jb20iLCJsZXZlbDJfYWNjZXNzIjp0cnVlLCJtZXRhIjp7Im9pZCI6ImM4MlNIMFdaT3NhYk9YR1Ayc3hxY2ozNEZ4a3ZmbldSWkJLbEJqRlMiLCJvbiI6IlJvYmluaG9vZCJ9LCJvcHRpb25zIjp0cnVlLCJwb3MiOiJwIiwic2NvcGUiOiJpbnRlcm5hbCIsInNlcnZpY2VfcmVjb3JkcyI6W3siaGFsdGVkIjpmYWxzZSwic2VydmljZSI6ImNlcmVzX3VzIiwic2hhcmRfaWQiOjEsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoibnVtbXVzX3VzIiwic2hhcmRfaWQiOjIsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoiYnJva2ViYWNrX3VzIiwic2hhcmRfaWQiOjEzLCJzdGF0ZSI6ImF2YWlsYWJsZSJ9XSwic2xnIjoxLCJzbHMiOiJrTU5CcGdDaldRTmNiaURiSGtXS2M2NGhleDd5dzdUVWdVN2ZxY1VoRmdXcGNHUTQwVmgxbmU0ZE5CWHVzT3duOEU4d3J2eHBsbFRqU3lFVDU2bk9EZz09Iiwic3JtIjp7ImIiOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjEzfSwiYyI6eyJobCI6ZmFsc2UsInIiOiJ1cyIsInNpZCI6MX0sIm4iOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjJ9fSwidG9rZW4iOiJ3ZTlzNXpMSE5NclpkUDVRZHJxYWN6TFc0c3NmQmYiLCJ1c2VyX2lkIjoiYzY1ZmQyNTItYjg2NC00ZjBlLWE3NjctYmE0ZjJiZTMyZDcxIiwidXNlcl9vcmlnaW4iOiJVUyJ9.awcwoeCbk8VzAGSmcaF736sufIFjCXRefpKQb5noJIXwKuSIeO-YzALaam2HEAlIf1tMSckAZSsAttV-O0S1-w
origin
https://robinhood.com
priority
u=1, i
referer
https://robinhood.com/
sec-ch-ua
"Chromium";v="141", "Not?A_Brand";v="8"
sec-ch-ua-mobile
?0
sec-ch-ua-platform
"Windows"
sec-fetch-dest
empty
sec-fetch-mode
cors
sec-fetch-site
same-site
user-agent
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36
x-hyper-ex
enabled
x-timezone-id
America/New_York


Peticion 6:
https://api.robinhood.com/arsenal/v1/futures/contracts?productIds=f5e6b1cd-3d23-4add-8c51-385dd953a850
fetch("https://api.robinhood.com/arsenal/v1/futures/contracts?productIds=f5e6b1cd-3d23-4add-8c51-385dd953a850", {
  "headers": {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "authorization": "Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6IjIiLCJ0eXAiOiJKV1QifQ.eyJkY3QiOjE3NjI3NTkzNzIsImRldmljZV9oYXNoIjoiMTU1YTMxMTRiYTM1ZjI3NzMwODc5ZjRjYjljMDc2MjQiLCJleHAiOjE3NjUzMDA5MzQsImlzcyI6Imh0dHBzOi8vYXBpLnJvYmluaG9vZC5jb20iLCJsZXZlbDJfYWNjZXNzIjp0cnVlLCJtZXRhIjp7Im9pZCI6ImM4MlNIMFdaT3NhYk9YR1Ayc3hxY2ozNEZ4a3ZmbldSWkJLbEJqRlMiLCJvbiI6IlJvYmluaG9vZCJ9LCJvcHRpb25zIjp0cnVlLCJwb3MiOiJwIiwic2NvcGUiOiJpbnRlcm5hbCIsInNlcnZpY2VfcmVjb3JkcyI6W3siaGFsdGVkIjpmYWxzZSwic2VydmljZSI6ImNlcmVzX3VzIiwic2hhcmRfaWQiOjEsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoibnVtbXVzX3VzIiwic2hhcmRfaWQiOjIsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoiYnJva2ViYWNrX3VzIiwic2hhcmRfaWQiOjEzLCJzdGF0ZSI6ImF2YWlsYWJsZSJ9XSwic2xnIjoxLCJzbHMiOiJrTU5CcGdDaldRTmNiaURiSGtXS2M2NGhleDd5dzdUVWdVN2ZxY1VoRmdXcGNHUTQwVmgxbmU0ZE5CWHVzT3duOEU4d3J2eHBsbFRqU3lFVDU2bk9EZz09Iiwic3JtIjp7ImIiOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjEzfSwiYyI6eyJobCI6ZmFsc2UsInIiOiJ1cyIsInNpZCI6MX0sIm4iOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjJ9fSwidG9rZW4iOiJ3ZTlzNXpMSE5NclpkUDVRZHJxYWN6TFc0c3NmQmYiLCJ1c2VyX2lkIjoiYzY1ZmQyNTItYjg2NC00ZjBlLWE3NjctYmE0ZjJiZTMyZDcxIiwidXNlcl9vcmlnaW4iOiJVUyJ9.awcwoeCbk8VzAGSmcaF736sufIFjCXRefpKQb5noJIXwKuSIeO-YzALaam2HEAlIf1tMSckAZSsAttV-O0S1-w",
    "priority": "u=1, i",
    "rh-contract-protected": "true",
    "sec-ch-ua": "\"Chromium\";v=\"141\", \"Not?A_Brand\";v=\"8\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "x-timezone-id": "America/New_York",
    "Referer": "https://robinhood.com/"
  },
  "body": null,
  "method": "GET"
});

{"results":[{"id":"bd2b6728-a24d-448a-a2bc-655c18d8f5e8","productId":"f5e6b1cd-3d23-4add-8c51-385dd953a850","symbol":"/MESH26:XCME","displaySymbol":"/MESH26","description":"Micro E-mini S&P 500 Futures, Mar-26","multiplier":"5","expirationMmy":"202603","expiration":"2026-03-20","customerLastCloseDate":"2026-03-20","tradability":"FUTURES_TRADABILITY_TRADABLE","state":"FUTURES_STATE_ACTIVE","settlementStartTime":"08:30","firstTradeDate":"2024-05-01","settlementDate":"2026-03-20"},{"id":"c4021dc3-bc5c-4252-a5b9-209572a1cb78","productId":"f5e6b1cd-3d23-4add-8c51-385dd953a850","symbol":"/MESZ25:XCME","displaySymbol":"/MESZ25","description":"Micro E-mini S&P 500 Futures, Dec-25","multiplier":"5","expirationMmy":"202512","expiration":"2025-12-19","customerLastCloseDate":"2025-12-19","tradability":"FUTURES_TRADABILITY_TRADABLE","state":"FUTURES_STATE_ACTIVE","settlementStartTime":"08:30","firstTradeDate":"2024-05-01","settlementDate":"2025-12-19"}]}

payload: productIds=f5e6b1cd-3d23-4add-8c51-385dd953a850

Request URL
https://api.robinhood.com/arsenal/v1/futures/contracts?productIds=f5e6b1cd-3d23-4add-8c51-385dd953a850
Request Method
GET
Status Code
200 OK
Remote Address
[2607:7700:0:f::3455:4e09]:443
Referrer Policy
strict-origin-when-cross-origin
access-control-allow-credentials
true
access-control-allow-origin
https://robinhood.com
content-length
955
content-type
application/json
date
Mon, 10 Nov 2025 07:43:48 GMT
grpc-message
grpc-status
0
server
envoy
via
1.1 deb4333d946544018e87e421a8d3f79a.cloudfront.net (CloudFront)
x-amz-cf-id
ZeDvg7o9Uve_3VGK85FyumWyMZwsJp61QobpYorNw9BSicNGb7jgqg==
x-amz-cf-pop
MIA50-P6
x-cache
Miss from cloudfront
x-response-from
arsenal
:authority
api.robinhood.com
:method
GET
:path
/arsenal/v1/futures/contracts?productIds=f5e6b1cd-3d23-4add-8c51-385dd953a850
:scheme
https
accept
*/*
accept-encoding
gzip, deflate, br, zstd
accept-language
en-US,en;q=0.9
authorization
Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6IjIiLCJ0eXAiOiJKV1QifQ.eyJkY3QiOjE3NjI3NTkzNzIsImRldmljZV9oYXNoIjoiMTU1YTMxMTRiYTM1ZjI3NzMwODc5ZjRjYjljMDc2MjQiLCJleHAiOjE3NjUzMDA5MzQsImlzcyI6Imh0dHBzOi8vYXBpLnJvYmluaG9vZC5jb20iLCJsZXZlbDJfYWNjZXNzIjp0cnVlLCJtZXRhIjp7Im9pZCI6ImM4MlNIMFdaT3NhYk9YR1Ayc3hxY2ozNEZ4a3ZmbldSWkJLbEJqRlMiLCJvbiI6IlJvYmluaG9vZCJ9LCJvcHRpb25zIjp0cnVlLCJwb3MiOiJwIiwic2NvcGUiOiJpbnRlcm5hbCIsInNlcnZpY2VfcmVjb3JkcyI6W3siaGFsdGVkIjpmYWxzZSwic2VydmljZSI6ImNlcmVzX3VzIiwic2hhcmRfaWQiOjEsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoibnVtbXVzX3VzIiwic2hhcmRfaWQiOjIsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoiYnJva2ViYWNrX3VzIiwic2hhcmRfaWQiOjEzLCJzdGF0ZSI6ImF2YWlsYWJsZSJ9XSwic2xnIjoxLCJzbHMiOiJrTU5CcGdDaldRTmNiaURiSGtXS2M2NGhleDd5dzdUVWdVN2ZxY1VoRmdXcGNHUTQwVmgxbmU0ZE5CWHVzT3duOEU4d3J2eHBsbFRqU3lFVDU2bk9EZz09Iiwic3JtIjp7ImIiOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjEzfSwiYyI6eyJobCI6ZmFsc2UsInIiOiJ1cyIsInNpZCI6MX0sIm4iOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjJ9fSwidG9rZW4iOiJ3ZTlzNXpMSE5NclpkUDVRZHJxYWN6TFc0c3NmQmYiLCJ1c2VyX2lkIjoiYzY1ZmQyNTItYjg2NC00ZjBlLWE3NjctYmE0ZjJiZTMyZDcxIiwidXNlcl9vcmlnaW4iOiJVUyJ9.awcwoeCbk8VzAGSmcaF736sufIFjCXRefpKQb5noJIXwKuSIeO-YzALaam2HEAlIf1tMSckAZSsAttV-O0S1-w
origin
https://robinhood.com
priority
u=1, i
referer
https://robinhood.com/
rh-contract-protected
true
sec-ch-ua
"Chromium";v="141", "Not?A_Brand";v="8"
sec-ch-ua-mobile
?0
sec-ch-ua-platform
"Windows"
sec-fetch-dest
empty
sec-fetch-mode
cors
sec-fetch-site
same-site
user-agent
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36
x-timezone-id
America/New_York


Peticion 7:
https://api.robinhood.com/arsenal/v1/futures/trading_sessions/c4021dc3-bc5c-4252-a5b9-209572a1cb78/2025-11-10

fetch("https://api.robinhood.com/arsenal/v1/futures/trading_sessions/c4021dc3-bc5c-4252-a5b9-209572a1cb78/2025-11-10", {
  "headers": {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "authorization": "Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6IjIiLCJ0eXAiOiJKV1QifQ.eyJkY3QiOjE3NjI3NTkzNzIsImRldmljZV9oYXNoIjoiMTU1YTMxMTRiYTM1ZjI3NzMwODc5ZjRjYjljMDc2MjQiLCJleHAiOjE3NjUzMDA5MzQsImlzcyI6Imh0dHBzOi8vYXBpLnJvYmluaG9vZC5jb20iLCJsZXZlbDJfYWNjZXNzIjp0cnVlLCJtZXRhIjp7Im9pZCI6ImM4MlNIMFdaT3NhYk9YR1Ayc3hxY2ozNEZ4a3ZmbldSWkJLbEJqRlMiLCJvbiI6IlJvYmluaG9vZCJ9LCJvcHRpb25zIjp0cnVlLCJwb3MiOiJwIiwic2NvcGUiOiJpbnRlcm5hbCIsInNlcnZpY2VfcmVjb3JkcyI6W3siaGFsdGVkIjpmYWxzZSwic2VydmljZSI6ImNlcmVzX3VzIiwic2hhcmRfaWQiOjEsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoibnVtbXVzX3VzIiwic2hhcmRfaWQiOjIsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoiYnJva2ViYWNrX3VzIiwic2hhcmRfaWQiOjEzLCJzdGF0ZSI6ImF2YWlsYWJsZSJ9XSwic2xnIjoxLCJzbHMiOiJrTU5CcGdDaldRTmNiaURiSGtXS2M2NGhleDd5dzdUVWdVN2ZxY1VoRmdXcGNHUTQwVmgxbmU0ZE5CWHVzT3duOEU4d3J2eHBsbFRqU3lFVDU2bk9EZz09Iiwic3JtIjp7ImIiOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjEzfSwiYyI6eyJobCI6ZmFsc2UsInIiOiJ1cyIsInNpZCI6MX0sIm4iOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjJ9fSwidG9rZW4iOiJ3ZTlzNXpMSE5NclpkUDVRZHJxYWN6TFc0c3NmQmYiLCJ1c2VyX2lkIjoiYzY1ZmQyNTItYjg2NC00ZjBlLWE3NjctYmE0ZjJiZTMyZDcxIiwidXNlcl9vcmlnaW4iOiJVUyJ9.awcwoeCbk8VzAGSmcaF736sufIFjCXRefpKQb5noJIXwKuSIeO-YzALaam2HEAlIf1tMSckAZSsAttV-O0S1-w",
    "priority": "u=1, i",
    "rh-contract-protected": "true",
    "sec-ch-ua": "\"Chromium\";v=\"141\", \"Not?A_Brand\";v=\"8\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "x-timezone-id": "America/New_York",
    "Referer": "https://robinhood.com/"
  },
  "body": null,
  "method": "GET"
});

{"date":"2025-11-10","futuresContractId":"c4021dc3-bc5c-4252-a5b9-209572a1cb78","isHoliday":false,"startTime":"2025-11-09T21:55:00Z","endTime":"2025-11-10T22:40:00Z","sessions":[{"tradingDate":"2025-11-10","isTrading":false,"startTime":"2025-11-09T21:55:00Z","endTime":"2025-11-09T23:00:00Z","sessionType":"SESSION_TYPE_NO_TRADING"},{"tradingDate":"2025-11-10","isTrading":true,"startTime":"2025-11-09T23:00:00Z","endTime":"2025-11-10T22:00:00Z","sessionType":"SESSION_TYPE_REGULAR"},{"tradingDate":"2025-11-10","isTrading":false,"startTime":"2025-11-10T22:00:00Z","endTime":"2025-11-10T22:40:00Z","sessionType":"SESSION_TYPE_NO_TRADING"}],"currentSession":{"tradingDate":"2025-11-10","isTrading":true,"startTime":"2025-11-09T23:00:00Z","endTime":"2025-11-10T22:00:00Z","sessionType":"SESSION_TYPE_REGULAR"},"previousSession":{"tradingDate":"2025-11-07","isTrading":true,"startTime":"2025-11-06T23:00:00Z","endTime":"2025-11-07T22:00:00Z","sessionType":"SESSION_TYPE_REGULAR"},"nextSession":{"tradingDate":"2025-11-11","isTrading":true,"startTime":"2025-11-10T23:00:00Z","endTime":"2025-11-11T22:00:00Z","sessionType":"SESSION_TYPE_REGULAR"}}

Request URL
https://api.robinhood.com/arsenal/v1/futures/trading_sessions/c4021dc3-bc5c-4252-a5b9-209572a1cb78/2025-11-10
Request Method
GET
Status Code
200 OK
Remote Address
[2607:7700:0:f::3455:4e09]:443
Referrer Policy
strict-origin-when-cross-origin
access-control-allow-credentials
true
access-control-allow-origin
https://robinhood.com
content-length
1142
content-type
application/json
date
Mon, 10 Nov 2025 07:43:48 GMT
grpc-message
grpc-status
0
server
envoy
via
1.1 deb4333d946544018e87e421a8d3f79a.cloudfront.net (CloudFront)
x-amz-cf-id
jn_GSvFkdzjgCtPQ7DxfOX7CU_cRYfCJ1fr5CuFtKOBdmgJ1frsYsQ==
x-amz-cf-pop
MIA50-P6
x-cache
Miss from cloudfront
x-response-from
arsenal
:authority
api.robinhood.com
:method
GET
:path
/arsenal/v1/futures/trading_sessions/c4021dc3-bc5c-4252-a5b9-209572a1cb78/2025-11-10
:scheme
https
accept
*/*
accept-encoding
gzip, deflate, br, zstd
accept-language
en-US,en;q=0.9
authorization
Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6IjIiLCJ0eXAiOiJKV1QifQ.eyJkY3QiOjE3NjI3NTkzNzIsImRldmljZV9oYXNoIjoiMTU1YTMxMTRiYTM1ZjI3NzMwODc5ZjRjYjljMDc2MjQiLCJleHAiOjE3NjUzMDA5MzQsImlzcyI6Imh0dHBzOi8vYXBpLnJvYmluaG9vZC5jb20iLCJsZXZlbDJfYWNjZXNzIjp0cnVlLCJtZXRhIjp7Im9pZCI6ImM4MlNIMFdaT3NhYk9YR1Ayc3hxY2ozNEZ4a3ZmbldSWkJLbEJqRlMiLCJvbiI6IlJvYmluaG9vZCJ9LCJvcHRpb25zIjp0cnVlLCJwb3MiOiJwIiwic2NvcGUiOiJpbnRlcm5hbCIsInNlcnZpY2VfcmVjb3JkcyI6W3siaGFsdGVkIjpmYWxzZSwic2VydmljZSI6ImNlcmVzX3VzIiwic2hhcmRfaWQiOjEsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoibnVtbXVzX3VzIiwic2hhcmRfaWQiOjIsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoiYnJva2ViYWNrX3VzIiwic2hhcmRfaWQiOjEzLCJzdGF0ZSI6ImF2YWlsYWJsZSJ9XSwic2xnIjoxLCJzbHMiOiJrTU5CcGdDaldRTmNiaURiSGtXS2M2NGhleDd5dzdUVWdVN2ZxY1VoRmdXcGNHUTQwVmgxbmU0ZE5CWHVzT3duOEU4d3J2eHBsbFRqU3lFVDU2bk9EZz09Iiwic3JtIjp7ImIiOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjEzfSwiYyI6eyJobCI6ZmFsc2UsInIiOiJ1cyIsInNpZCI6MX0sIm4iOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjJ9fSwidG9rZW4iOiJ3ZTlzNXpMSE5NclpkUDVRZHJxYWN6TFc0c3NmQmYiLCJ1c2VyX2lkIjoiYzY1ZmQyNTItYjg2NC00ZjBlLWE3NjctYmE0ZjJiZTMyZDcxIiwidXNlcl9vcmlnaW4iOiJVUyJ9.awcwoeCbk8VzAGSmcaF736sufIFjCXRefpKQb5noJIXwKuSIeO-YzALaam2HEAlIf1tMSckAZSsAttV-O0S1-w
origin
https://robinhood.com
priority
u=1, i
referer
https://robinhood.com/
rh-contract-protected
true
sec-ch-ua
"Chromium";v="141", "Not?A_Brand";v="8"
sec-ch-ua-mobile
?0
sec-ch-ua-platform
"Windows"
sec-fetch-dest
empty
sec-fetch-mode
cors
sec-fetch-site
same-site
user-agent
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36
x-timezone-id
America/New_York


================================================================
"futures-overview" (Panel general de futuros) en https://robinhood.com/lists/robinhood/12442aa7-2280-4d5a-86e4-1ee5353f3892/

Peticiones:

Peticion 1:
https://api.robinhood.com/inbox/threads/

fetch("https://api.robinhood.com/inbox/threads/", {
  "headers": {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "authorization": "Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6IjIiLCJ0eXAiOiJKV1QifQ.eyJkY3QiOjE3NjI3NTkzNzIsImRldmljZV9oYXNoIjoiMTU1YTMxMTRiYTM1ZjI3NzMwODc5ZjRjYjljMDc2MjQiLCJleHAiOjE3NjUzMDA5MzQsImlzcyI6Imh0dHBzOi8vYXBpLnJvYmluaG9vZC5jb20iLCJsZXZlbDJfYWNjZXNzIjp0cnVlLCJtZXRhIjp7Im9pZCI6ImM4MlNIMFdaT3NhYk9YR1Ayc3hxY2ozNEZ4a3ZmbldSWkJLbEJqRlMiLCJvbiI6IlJvYmluaG9vZCJ9LCJvcHRpb25zIjp0cnVlLCJwb3MiOiJwIiwic2NvcGUiOiJpbnRlcm5hbCIsInNlcnZpY2VfcmVjb3JkcyI6W3siaGFsdGVkIjpmYWxzZSwic2VydmljZSI6ImNlcmVzX3VzIiwic2hhcmRfaWQiOjEsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoibnVtbXVzX3VzIiwic2hhcmRfaWQiOjIsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoiYnJva2ViYWNrX3VzIiwic2hhcmRfaWQiOjEzLCJzdGF0ZSI6ImF2YWlsYWJsZSJ9XSwic2xnIjoxLCJzbHMiOiJrTU5CcGdDaldRTmNiaURiSGtXS2M2NGhleDd5dzdUVWdVN2ZxY1VoRmdXcGNHUTQwVmgxbmU0ZE5CWHVzT3duOEU4d3J2eHBsbFRqU3lFVDU2bk9EZz09Iiwic3JtIjp7ImIiOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjEzfSwiYyI6eyJobCI6ZmFsc2UsInIiOiJ1cyIsInNpZCI6MX0sIm4iOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjJ9fSwidG9rZW4iOiJ3ZTlzNXpMSE5NclpkUDVRZHJxYWN6TFc0c3NmQmYiLCJ1c2VyX2lkIjoiYzY1ZmQyNTItYjg2NC00ZjBlLWE3NjctYmE0ZjJiZTMyZDcxIiwidXNlcl9vcmlnaW4iOiJVUyJ9.awcwoeCbk8VzAGSmcaF736sufIFjCXRefpKQb5noJIXwKuSIeO-YzALaam2HEAlIf1tMSckAZSsAttV-O0S1-w",
    "priority": "u=1, i",
    "sec-ch-ua": "\"Chromium\";v=\"141\", \"Not?A_Brand\";v=\"8\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "Referer": "https://robinhood.com/"
  },
  "body": null,
  "method": "GET"
});

{"results":[{"id":"3275019698206418630","pagination_id":"03275019698248361401","display_name":"Announcements","short_display_name":"!","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"👋 Hi there! Welcome to Notifications. This is one place you can expect to receive timely and relevant information from us once you start trading.","attributes":null},"most_recent_message":{"id":"3275019698248361401","thread_id":"3275019698206418630","response_message_id":null,"message_type_config_id":null,"message_config_id":"250","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Announcements","short_display_name":"!","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"👋 Hi there! Welcome to Notifications. This is one place you can expect to receive timely and relevant information from us once you start trading.","attributes":null},"action":{"value":"5794","display_text":"Learn more","url":"robinhood://web?url=https://robinhood.com/support/articles/messages/"},"media":null,"remote_medias":[],"responses":[],"created_at":"2025-05-16T15:59:31.492429Z","updated_at":"2025-05-16T15:59:31.492429Z"},"last_message_sent_at":"2025-05-16T15:59:31.492429Z","avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_announcement_avatar.png","entity_url":null,"avatar_color":"#21CE99","options":{"allows_free_text":false,"has_settings":false}},{"id":"3279334038044681983","pagination_id":"03289136727553222491","display_name":"Solana","short_display_name":"SOL","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your market order to sell 6.3418 SOL was filled for $974.35.","attributes":null},"most_recent_message":{"id":"3289136727553222491","thread_id":"3279334038044681983","response_message_id":null,"message_type_config_id":"347","message_config_id":"3370163","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Solana","short_display_name":"SOL","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your market order to sell 6.3418 SOL was filled for $974.35.","attributes":null},"action":{"value":"621725","display_text":"View order details","url":"robinhood://orders?id=68410ea1-95bc-4c88-b669-48c6678672e9\u0026type=currency"},"media":null,"remote_medias":[],"responses":[],"created_at":"2025-06-05T03:27:32.522058Z","updated_at":"2025-06-05T03:27:32.522058Z"},"last_message_sent_at":"2025-06-05T03:27:32.522058Z","avatar_url":null,"entity_url":"robinhood://currency_pair?id=0cdc8c93-fbda-462f-94b7-26353d87a009","avatar_color":"#DB50C8","options":{"allows_free_text":false,"has_settings":true}},{"id":"3280789881441232456","pagination_id":"03307121089989059684","display_name":"Moo Deng","short_display_name":"MOODENG","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your market order to sell 50 MOODENG was filled for $7.97.","attributes":null},"most_recent_message":{"id":"3307121089989059684","thread_id":"3280789881441232456","response_message_id":null,"message_type_config_id":"347","message_config_id":"3370163","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Moo Deng","short_display_name":"MOODENG","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your market order to sell 50 MOODENG was filled for $7.97.","attributes":null},"action":{"value":"621725","display_text":"View order details","url":"robinhood://orders?id=6861c53d-62f2-46df-b81b-a58c7c5516e9\u0026type=currency"},"media":null,"remote_medias":[],"responses":[],"created_at":"2025-06-29T22:59:15.59551Z","updated_at":"2025-06-29T22:59:15.59551Z"},"last_message_sent_at":"2025-06-29T22:59:15.59551Z","avatar_url":null,"entity_url":"robinhood://currency_pair?id=3d28e79c-584d-43ad-b27d-5f2382efd3b8","avatar_color":"#70D4FF","options":{"allows_free_text":false,"has_settings":true}},{"id":"3278918291468330406","pagination_id":"03284444838765798942","display_name":"Bitcoin","short_display_name":"BTC","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your market order to sell 0.01345291 BTC was filled for $1,438.94.","attributes":null},"most_recent_message":{"id":"3284444838765798942","thread_id":"3278918291468330406","response_message_id":null,"message_type_config_id":"347","message_config_id":"3370163","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Bitcoin","short_display_name":"BTC","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your market order to sell 0.01345291 BTC was filled for $1,438.94.","attributes":null},"action":{"value":"621725","display_text":"View order details","url":"robinhood://orders?id=683885c9-c884-4ac2-b03e-479939d58529\u0026type=currency"},"media":null,"remote_medias":[],"responses":[],"created_at":"2025-05-29T16:05:35.797608Z","updated_at":"2025-05-29T16:05:35.797608Z"},"last_message_sent_at":"2025-05-29T16:05:35.797608Z","avatar_url":null,"entity_url":"robinhood://currency_pair?id=3d961844-d360-45fc-989b-f6fca761d511","avatar_color":"#F49431","options":{"allows_free_text":false,"has_settings":true}},{"id":"3280790387903440459","pagination_id":"03307121342100284546","display_name":"cat in a dogs world","short_display_name":"MEW","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your market order to sell 1,188 MEW was filled for $3.30.","attributes":null},"most_recent_message":{"id":"3307121342100284546","thread_id":"3280790387903440459","response_message_id":null,"message_type_config_id":"347","message_config_id":"3370163","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"cat in a dogs world","short_display_name":"MEW","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your market order to sell 1,188 MEW was filled for $3.30.","attributes":null},"action":{"value":"621725","display_text":"View order details","url":"robinhood://orders?id=6861c55a-bb86-4e83-b75c-199441039591\u0026type=currency"},"media":null,"remote_medias":[],"responses":[],"created_at":"2025-06-29T22:59:45.649427Z","updated_at":"2025-06-29T22:59:45.649427Z"},"last_message_sent_at":"2025-06-29T22:59:45.649427Z","avatar_url":null,"entity_url":"robinhood://currency_pair?id=c2f4bb30-7dbe-4c6c-9d3e-9f4207b56b44","avatar_color":"#FEBD30","options":{"allows_free_text":false,"has_settings":true}},{"id":"3297406076122572353","pagination_id":"03381606236419008415","display_name":"IPO Access","short_display_name":"IPOA","is_read":true,"is_critical":false,"is_muted":false,"preview_text":{"text":"PXED’s final prospectus and Robinhood’s allocation stats are now available for your review.","attributes":null},"most_recent_message":{"id":"3381606236419008415","thread_id":"3297406076122572353","response_message_id":null,"message_type_config_id":"c5788756-e185-4b8f-83f8-3dc6960a4ecf","message_config_id":"3373356","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"IPO Access","short_display_name":"IPOA","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"PXED’s final prospectus and Robinhood’s allocation stats are now available for your review.","attributes":null},"action":{"value":"622251","display_text":"View details","url":"robinhood://instruments?symbol=PXED"},"media":null,"remote_medias":[],"responses":[],"created_at":"2025-10-10T17:27:56.98123Z","updated_at":"2025-10-10T17:27:56.98123Z"},"last_message_sent_at":"2025-10-10T17:27:56.98123Z","avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_ipoa_avatar.png","entity_url":null,"avatar_color":"#00C000","options":{"allows_free_text":false,"has_settings":false}},{"id":"3275032404430955940","pagination_id":"13403769817704965509","display_name":"Robinhood","short_display_name":"R","is_read":false,"is_critical":true,"is_muted":false,"preview_text":{"text":"Your Robinhood account was logged in from Chrome (Windows) near Fort Lauderdale, FL. \n\nTime: 2025-11-10 02:22:52 EDT  \n\nIP address: 172.58.131.146 \n\nIf you didn't make this change, or have any questions or concerns, please update your password and contact us immediately.","attributes":null},"most_recent_message":{"id":"3403769817704965509","thread_id":"3275032404430955940","response_message_id":null,"message_type_config_id":"0c078cfa-06c0-4f61-8fa1-62a2dfe35a4e","message_config_id":"3886704","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Robinhood","short_display_name":"R","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your Robinhood account was logged in from Chrome (Windows) near Fort Lauderdale, FL. \n\nTime: 2025-11-10 02:22:52 EDT  \n\nIP address: 172.58.131.146 \n\nIf you didn't make this change, or have any questions or concerns, please update your password and contact us immediately.","attributes":null},"action":{"value":"622450","display_text":"Update password","url":"robinhood://update_password"},"media":null,"remote_medias":[],"responses":[],"created_at":"2025-11-10T07:23:01.760558Z","updated_at":"2025-11-10T07:23:01.760558Z"},"last_message_sent_at":"2025-11-10T07:23:01.760558Z","avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_thread_avatar.png","entity_url":null,"avatar_color":"#21CE99","options":{"allows_free_text":false,"has_settings":false}},{"id":"3288721160711185765","pagination_id":"03288733937332922315","display_name":"Invesco QQQ","short_display_name":"QQQ","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to sell to close 1 contract of QQQ $528.00 Call 6/4 has been filled for an average price of $84.00 per contract. \n\nYour order is complete.","attributes":null},"most_recent_message":{"id":"3288733937332922315","thread_id":"3288721160711185765","response_message_id":null,"message_type_config_id":"982","message_config_id":"3370953","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Invesco QQQ","short_display_name":"QQQ","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to sell to close 1 contract of QQQ $528.00 Call 6/4 has been filled for an average price of $84.00 per contract. \n\nYour order is complete.","attributes":null},"action":{"value":"622451","display_text":"View Order","url":"robinhood://orders?id=68405312-6fff-432a-a3a7-c433a61125c8\u0026type=option"},"media":null,"remote_medias":[],"responses":[{"display_text":"I'd like to place a new order. 😎","answer":"239170"},{"display_text":"Hooray! 🙌","answer":"238725"}],"created_at":"2025-06-04T14:07:16.186725Z","updated_at":"2025-06-04T14:07:16.186725Z"},"last_message_sent_at":"2025-06-04T14:07:16.186725Z","avatar_url":null,"entity_url":"robinhood://instrument?id=1790dd4f-a7ff-409e-90de-cad5efafde10","avatar_color":"#FF9F10","options":{"allows_free_text":false,"has_settings":true}},{"id":"3284293182950483836","pagination_id":"03289535738596566106","display_name":"AMC Entertainment","short_display_name":"AMC","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to sell 100 shares of AMC through your individual account has been filled at an average price of $3.44 per share.\n\nYour order is complete.","attributes":null},"most_recent_message":{"id":"3289535738596566106","thread_id":"3284293182950483836","response_message_id":null,"message_type_config_id":"2765","message_config_id":"3370914","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"AMC Entertainment","short_display_name":"AMC","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to sell 100 shares of AMC through your individual account has been filled at an average price of $3.44 per share.\n\nYour order is complete.","attributes":null},"action":null,"media":null,"remote_medias":[],"responses":[{"display_text":"Can I see more details? 🤓","answer":"238736"},{"display_text":"I'd like to place a new order.","answer":"238738"}],"created_at":"2025-06-05T16:40:18.349101Z","updated_at":"2025-06-05T16:40:18.349101Z"},"last_message_sent_at":"2025-06-05T16:40:18.349101Z","avatar_url":null,"entity_url":"robinhood://instrument?id=2690d965-cbac-4865-ad7c-34881b10f81e","avatar_color":"#EE3215","options":{"allows_free_text":false,"has_settings":true}},{"id":"3323006105545615170","pagination_id":"03391085318454125887","display_name":"S\u0026P 500 Index","short_display_name":"SPX","is_read":true,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to sell to close 1 contract of SPXW 6,625.00 Put 10/23 has been filled for an average price of $5.00 per contract. \n\nYour order is complete.","attributes":null},"most_recent_message":{"id":"3391085318454125887","thread_id":"3323006105545615170","response_message_id":null,"message_type_config_id":"948","message_config_id":"3370953","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"S\u0026P 500 Index","short_display_name":"SPX","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to sell to close 1 contract of SPXW 6,625.00 Put 10/23 has been filled for an average price of $5.00 per contract. \n\nYour order is complete.","attributes":null},"action":{"value":"622451","display_text":"View Order","url":"robinhood://orders?id=68fa7f5e-b7cc-45bf-a088-2835e5a94653\u0026type=option"},"media":null,"remote_medias":[],"responses":[{"display_text":"I'd like to place a new order. 😎","answer":"239170"},{"display_text":"Hooray! 🙌","answer":"238725"}],"created_at":"2025-10-23T19:21:11.616184Z","updated_at":"2025-10-23T19:21:11.616184Z"},"last_message_sent_at":"2025-10-23T19:21:11.616184Z","avatar_url":null,"entity_url":null,"avatar_color":"#9571FD","options":{"allows_free_text":false,"has_settings":true}},{"id":"3280356751823611224","pagination_id":"03282852295728965288","display_name":"Apple","short_display_name":"AAPL","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to buy 3 shares of AAPL through your individual account was canceled.","attributes":null},"most_recent_message":{"id":"3282852295728965288","thread_id":"3280356751823611224","response_message_id":null,"message_type_config_id":"3bbafacd-b5a2-4213-86be-16d47867fb9e","message_config_id":"3371539","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Apple","short_display_name":"AAPL","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to buy 3 shares of AAPL through your individual account was canceled.","attributes":null},"action":null,"media":null,"remote_medias":[],"responses":[{"display_text":"Can I see more details? 🤓","answer":"238736"},{"display_text":"I'd like to place a new order.","answer":"238738"}],"created_at":"2025-05-27T11:21:29.869392Z","updated_at":"2025-05-27T11:21:29.869392Z"},"last_message_sent_at":"2025-05-27T11:21:29.869392Z","avatar_url":null,"entity_url":"robinhood://instrument?id=450dfc6d-5510-4d40-abfb-f633b7d9be3e","avatar_color":"#A3AAAE","options":{"allows_free_text":false,"has_settings":true}},{"id":"3279617833671074886","pagination_id":"03299080661591139668","display_name":"Lucid Group","short_display_name":"LCID","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to sell 0.233206 shares of LCID through your individual account has been filled at an average price of $2.22 per share.\n\nYour order is complete.","attributes":null},"most_recent_message":{"id":"3299080661591139668","thread_id":"3279617833671074886","response_message_id":null,"message_type_config_id":"2639","message_config_id":"3370914","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Lucid Group","short_display_name":"LCID","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to sell 0.233206 shares of LCID through your individual account has been filled at an average price of $2.22 per share.\n\nYour order is complete.","attributes":null},"action":null,"media":null,"remote_medias":[],"responses":[{"display_text":"Can I see more details? 🤓","answer":"238736"},{"display_text":"I'd like to place a new order.","answer":"238738"}],"created_at":"2025-06-18T20:44:21.838854Z","updated_at":"2025-06-18T20:44:21.838854Z"},"last_message_sent_at":"2025-06-18T20:44:21.838854Z","avatar_url":null,"entity_url":"robinhood://instrument?id=4dd45c8b-8e89-4fd1-894d-018e3f06a8e5","avatar_color":"#FFDB1F","options":{"allows_free_text":false,"has_settings":true}},{"id":"3375729305697920225","pagination_id":"03376514563829671215","display_name":"Nasdaq-100 Index","short_display_name":"NDX","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to sell to close 1 contract of NDXP 25,370.00 Call 10/3 has been filled for an average price of $5.00 per contract. \n\nYour order is complete.","attributes":null},"most_recent_message":{"id":"3376514563829671215","thread_id":"3375729305697920225","response_message_id":null,"message_type_config_id":"90f0fa1b-0b21-488c-a48c-d233a8e3ed1a","message_config_id":"3370953","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Nasdaq-100 Index","short_display_name":"NDX","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to sell to close 1 contract of NDXP 25,370.00 Call 10/3 has been filled for an average price of $5.00 per contract. \n\nYour order is complete.","attributes":null},"action":{"value":"622451","display_text":"View Order","url":"robinhood://orders?id=68dfff1b-8564-4ca3-ae58-9d9e9e08bed1\u0026type=option"},"media":null,"remote_medias":[],"responses":[{"display_text":"I'd like to place a new order. 😎","answer":"239170"},{"display_text":"Hooray! 🙌","answer":"238725"}],"created_at":"2025-10-03T16:51:42.30894Z","updated_at":"2025-10-03T16:51:42.30894Z"},"last_message_sent_at":"2025-10-03T16:51:42.30894Z","avatar_url":null,"entity_url":null,"avatar_color":"#FF4392","options":{"allows_free_text":false,"has_settings":true}},{"id":"3278744879907218484","pagination_id":"03369272415031928343","display_name":"Alphabet Class A","short_display_name":"GOOGL","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to sell 0.294176 shares of GOOGL through your individual (•••2153) account has been filled at an average price of $253.30 per share.\n\nYour order is complete.","attributes":null},"most_recent_message":{"id":"3369272415031928343","thread_id":"3278744879907218484","response_message_id":null,"message_type_config_id":"2765","message_config_id":"3370914","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Alphabet Class A","short_display_name":"GOOGL","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to sell 0.294176 shares of GOOGL through your individual (•••2153) account has been filled at an average price of $253.30 per share.\n\nYour order is complete.","attributes":null},"action":null,"media":null,"remote_medias":[],"responses":[{"display_text":"Can I see more details? 🤓","answer":"238736"},{"display_text":"I'd like to place a new order.","answer":"238738"}],"created_at":"2025-09-23T17:02:50.898761Z","updated_at":"2025-09-23T17:02:50.898761Z"},"last_message_sent_at":"2025-09-23T17:02:50.898761Z","avatar_url":null,"entity_url":"robinhood://instrument?id=54db869e-f7d5-45fb-88f1-8d7072d4c8b2","avatar_color":"#EE3215","options":{"allows_free_text":false,"has_settings":true}},{"id":"3287416216636892717","pagination_id":"03290283695205787320","display_name":"Fractyl Health, Inc.","short_display_name":"GUTS","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to sell 7.94281 shares of GUTS through your individual account has been filled at an average price of $1.98 per share.\n\nYour order is complete.","attributes":null},"most_recent_message":{"id":"3290283695205787320","thread_id":"3287416216636892717","response_message_id":null,"message_type_config_id":"2765","message_config_id":"3370914","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Fractyl Health, Inc.","short_display_name":"GUTS","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to sell 7.94281 shares of GUTS through your individual account has been filled at an average price of $1.98 per share.\n\nYour order is complete.","attributes":null},"action":null,"media":null,"remote_medias":[],"responses":[{"display_text":"Can I see more details? 🤓","answer":"238736"},{"display_text":"I'd like to place a new order.","answer":"238738"}],"created_at":"2025-06-06T17:26:21.72519Z","updated_at":"2025-06-06T17:26:21.72519Z"},"last_message_sent_at":"2025-06-06T17:26:21.72519Z","avatar_url":null,"entity_url":"robinhood://instrument?id=56ee2b51-bbf8-4054-9db9-35e34fd59795","avatar_color":"#9571FD","options":{"allows_free_text":false,"has_settings":true}},{"id":"3353998207930606957","pagination_id":"03359420235026277509","display_name":"Klarna Group","short_display_name":"KLAR","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"KLAR finalized its price to $40.00. You can submit a request for initial public offering (IPO) shares. \n\nYou have until September 9th, 2025 at 11:59 PM to submit your request.","attributes":null},"most_recent_message":{"id":"3359420235026277509","thread_id":"3353998207930606957","response_message_id":null,"message_type_config_id":"2590d21f-997b-46a1-808b-da21f94da1b0","message_config_id":"3371573","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Klarna Group","short_display_name":"KLAR","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"KLAR finalized its price to $40.00. You can submit a request for initial public offering (IPO) shares. \n\nYou have until September 9th, 2025 at 11:59 PM to submit your request.","attributes":null},"action":{"value":"622466","display_text":"Request shares","url":"robinhood://ipo_access_notification_disclosure?id=5ba5ee58-2b48-4092-aee9-85173c8cb879\u0026destination=enter_ipo_access_order\u0026source=inbox_deeplink"},"media":null,"remote_medias":[],"responses":[],"created_at":"2025-09-10T02:48:19.519441Z","updated_at":"2025-09-10T02:48:19.519441Z"},"last_message_sent_at":"2025-09-10T02:48:19.519441Z","avatar_url":null,"entity_url":"robinhood://instrument?id=5ba5ee58-2b48-4092-aee9-85173c8cb879","avatar_color":"#FF9F10","options":{"allows_free_text":false,"has_settings":true}},{"id":"3323045008285640140","pagination_id":"03330172422644049785","display_name":"Figma","short_display_name":"FIG","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to buy 1 share of FIG through your individual account was canceled.","attributes":null},"most_recent_message":{"id":"3330172422644049785","thread_id":"3323045008285640140","response_message_id":null,"message_type_config_id":"2380","message_config_id":"3371539","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Figma","short_display_name":"FIG","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to buy 1 share of FIG through your individual account was canceled.","attributes":null},"action":null,"media":null,"remote_medias":[],"responses":[{"display_text":"Can I see more details? 🤓","answer":"238736"},{"display_text":"I'd like to place a new order.","answer":"238738"}],"created_at":"2025-07-31T18:18:08.580469Z","updated_at":"2025-07-31T18:18:08.580469Z"},"last_message_sent_at":"2025-07-31T18:18:08.580469Z","avatar_url":null,"entity_url":"robinhood://instrument?id=5d6b1a8d-1d5a-48f3-a4b6-68cdf641199a","avatar_color":"#FEBD30","options":{"allows_free_text":false,"has_settings":true}},{"id":"3287417587301885545","pagination_id":"03289519827756000915","display_name":"Argo Blockchain","short_display_name":"ARBK","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to sell 10 shares of ARBK through your individual account has been filled at an average price of $0.43 per share.\n\nYour order is complete.","attributes":null},"most_recent_message":{"id":"3289519827756000915","thread_id":"3287417587301885545","response_message_id":null,"message_type_config_id":"2765","message_config_id":"3370914","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Argo Blockchain","short_display_name":"ARBK","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to sell 10 shares of ARBK through your individual account has been filled at an average price of $0.43 per share.\n\nYour order is complete.","attributes":null},"action":null,"media":null,"remote_medias":[],"responses":[{"display_text":"Can I see more details? 🤓","answer":"238736"},{"display_text":"I'd like to place a new order.","answer":"238738"}],"created_at":"2025-06-05T16:08:41.629824Z","updated_at":"2025-06-05T16:08:41.629824Z"},"last_message_sent_at":"2025-06-05T16:08:41.629824Z","avatar_url":null,"entity_url":"robinhood://instrument?id=6040050c-db50-4dee-8879-a02c05fd603c","avatar_color":"#FB7137","options":{"allows_free_text":false,"has_settings":true}},{"id":"3344609223890707923","pagination_id":"03344697784539293314","display_name":"T-Rex 2X Long NVIDIA Daily Target ETF","short_display_name":"NVDX","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to sell to close 1 contract of NVDX $17.00 Call 8/22 has been filled for an average price of $55.00 per contract. \n\nYour order is complete.","attributes":null},"most_recent_message":{"id":"3344697784539293314","thread_id":"3344609223890707923","response_message_id":null,"message_type_config_id":"982","message_config_id":"3370953","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"T-Rex 2X Long NVIDIA Daily Target ETF","short_display_name":"NVDX","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to sell to close 1 contract of NVDX $17.00 Call 8/22 has been filled for an average price of $55.00 per contract. \n\nYour order is complete.","attributes":null},"action":{"value":"622451","display_text":"View Order","url":"robinhood://orders?id=68a60ff6-197a-49e2-a3e0-e97348595993\u0026type=option"},"media":null,"remote_medias":[],"responses":[{"display_text":"I'd like to place a new order. 😎","answer":"239170"},{"display_text":"Hooray! 🙌","answer":"238725"}],"created_at":"2025-08-20T19:17:26.653028Z","updated_at":"2025-08-20T19:17:26.653028Z"},"last_message_sent_at":"2025-08-20T19:17:26.653028Z","avatar_url":null,"entity_url":"robinhood://instrument?id=647dfbbc-9707-498e-b3d1-5e14fe8dc8b7","avatar_color":"#70D4FF","options":{"allows_free_text":false,"has_settings":true}},{"id":"3282970132275536992","pagination_id":"03289439338995131977","display_name":"Circle Internet Group","short_display_name":"CRCL","is_read":true,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your request to buy 10 initial public offering (IPO) shares of CRCL was not confirmed at its new price and was automatically canceled. We’ve returned $270.00 buying power.","attributes":null},"most_recent_message":{"id":"3289439338995131977","thread_id":"3282970132275536992","response_message_id":null,"message_type_config_id":"38d04018-795c-4427-bc38-934f960df726","message_config_id":"3374099","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Circle Internet Group","short_display_name":"CRCL","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your request to buy 10 initial public offering (IPO) shares of CRCL was not confirmed at its new price and was automatically canceled. We’ve returned $270.00 buying power.","attributes":null},"action":{"value":"621770","display_text":"View order","url":"robinhood://orders?id=6835e73f-0ce9-47db-8323-6abd72ef6b29"},"media":null,"remote_medias":[],"responses":[],"created_at":"2025-06-05T13:28:46.617053Z","updated_at":"2025-06-05T13:28:46.617053Z"},"last_message_sent_at":"2025-06-05T13:28:46.617053Z","avatar_url":null,"entity_url":"robinhood://instrument?id=68bd6242-94d5-4eba-b0d5-f03b2ca9af3a","avatar_color":"#D45BFF","options":{"allows_free_text":false,"has_settings":true}},{"id":"3282940648147133834","pagination_id":"03290184040765728098","display_name":"Ford Motor","short_display_name":"F","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to sell to close 1 contract of F $10.50 Call 6/6 has been filled for an average price of $1.00 per contract. \n\nYour order is complete.","attributes":null},"most_recent_message":{"id":"3290184040765728098","thread_id":"3282940648147133834","response_message_id":null,"message_type_config_id":"982","message_config_id":"3370953","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Ford Motor","short_display_name":"F","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to sell to close 1 contract of F $10.50 Call 6/6 has been filled for an average price of $1.00 per contract. \n\nYour order is complete.","attributes":null},"action":{"value":"622451","display_text":"View Order","url":"robinhood://orders?id=6842f654-2052-4cd0-8e16-84c4053e5e41\u0026type=option"},"media":null,"remote_medias":[],"responses":[{"display_text":"I'd like to place a new order. 😎","answer":"239170"},{"display_text":"Hooray! 🙌","answer":"238725"}],"created_at":"2025-06-06T14:08:21.990647Z","updated_at":"2025-06-06T14:08:21.990647Z"},"last_message_sent_at":"2025-06-06T14:08:21.990647Z","avatar_url":null,"entity_url":"robinhood://instrument?id=6df56bd0-0bf2-44ab-8875-f94fd8526942","avatar_color":"#326BBD","options":{"allows_free_text":false,"has_settings":true}},{"id":"3374315904740369647","pagination_id":"03380764121594078603","display_name":"Phoenix Education Partners","short_display_name":"PXED","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your request to buy 40 initial public offering (IPO) shares of PXED could not be filled. \n\nIPO shares can be very limited and requests for shares are randomly selected. If there's more demand than supply for IPO shares, we’ll be unable to fill every request.","attributes":null},"most_recent_message":{"id":"3380764121594078603","thread_id":"3374315904740369647","response_message_id":null,"message_type_config_id":"68caca10-6e77-4801-8774-f2af3781568c","message_config_id":"3374101","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Phoenix Education Partners","short_display_name":"PXED","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your request to buy 40 initial public offering (IPO) shares of PXED could not be filled. \n\nIPO shares can be very limited and requests for shares are randomly selected. If there's more demand than supply for IPO shares, we’ll be unable to fill every request.","attributes":null},"action":{"value":"622464","display_text":"View details","url":"robinhood://ipo_access_results?id=75b52ab2-366d-4f84-89cc-534d2076fe64"},"media":null,"remote_medias":[],"responses":[],"created_at":"2025-10-09T13:34:49.072972Z","updated_at":"2025-10-09T13:34:49.072972Z"},"last_message_sent_at":"2025-10-09T13:34:49.072972Z","avatar_url":null,"entity_url":"robinhood://instrument?id=75b52ab2-366d-4f84-89cc-534d2076fe64","avatar_color":"#FEBD30","options":{"allows_free_text":false,"has_settings":true}},{"id":"3282982494290323338","pagination_id":"03302619290590521322","display_name":"AIRO Group Holdings","short_display_name":"AIRO","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to sell 10 shares of AIRO through your individual account has been filled at an average price of $27.37 per share.\n\nYour order is complete.","attributes":null},"most_recent_message":{"id":"3302619290590521322","thread_id":"3282982494290323338","response_message_id":null,"message_type_config_id":"2765","message_config_id":"3370914","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"AIRO Group Holdings","short_display_name":"AIRO","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to sell 10 shares of AIRO through your individual account has been filled at an average price of $27.37 per share.\n\nYour order is complete.","attributes":null},"action":null,"media":null,"remote_medias":[],"responses":[{"display_text":"Can I see more details? 🤓","answer":"238736"},{"display_text":"I'd like to place a new order.","answer":"238738"}],"created_at":"2025-06-23T17:54:59.28733Z","updated_at":"2025-06-23T17:54:59.28733Z"},"last_message_sent_at":"2025-06-23T17:54:59.28733Z","avatar_url":null,"entity_url":"robinhood://instrument?id=7c35e8d8-c623-4cd6-bf34-757a57fef6d5","avatar_color":"#70D4FF","options":{"allows_free_text":false,"has_settings":true}},{"id":"3305390480975472233","pagination_id":"03375756452533642431","display_name":"Netflix","short_display_name":"NFLX","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"You've canceled your order to buy to open 1 contract of NFLX $780.00 Put 11/21 in your individual (•••2153) account.","attributes":null},"most_recent_message":{"id":"3375756452533642431","thread_id":"3305390480975472233","response_message_id":null,"message_type_config_id":"866","message_config_id":"3372575","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Netflix","short_display_name":"NFLX","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"You've canceled your order to buy to open 1 contract of NFLX $780.00 Put 11/21 in your individual (•••2153) account.","attributes":null},"action":null,"media":null,"remote_medias":[],"responses":[{"display_text":"Can I see more details? 🤓","answer":"239173"},{"display_text":"I'd like to replace this order. 🙂","answer":"239166"}],"created_at":"2025-10-02T15:45:28.403255Z","updated_at":"2025-10-02T15:45:28.403255Z"},"last_message_sent_at":"2025-10-02T15:45:28.403255Z","avatar_url":null,"entity_url":"robinhood://instrument?id=81733743-965a-4d93-b87a-6973cb9efd34","avatar_color":"#EE3215","options":{"allows_free_text":false,"has_settings":true}},{"id":"3324229299111733050","pagination_id":"03366708451727123572","display_name":"Nasdaq","short_display_name":"NDAQ","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your NDAQ Call option in your individual (•••2153) account expired.","attributes":null},"most_recent_message":{"id":"3366708451727123572","thread_id":"3324229299111733050","response_message_id":null,"message_type_config_id":"538","message_config_id":"3372509","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Nasdaq","short_display_name":"NDAQ","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your NDAQ Call option in your individual (•••2153) account expired.","attributes":null},"action":{"value":"622579","display_text":"View Details","url":"robinhood://option_events?id=c2f86e9b-9996-4108-93e9-f2016e0f4baa"},"media":null,"remote_medias":[],"responses":[],"created_at":"2025-09-20T04:08:42.65236Z","updated_at":"2025-09-20T04:08:42.65236Z"},"last_message_sent_at":"2025-09-20T04:08:42.65236Z","avatar_url":null,"entity_url":"robinhood://instrument?id=8decc068-5bfd-4cc6-bb2c-f2efd3119536","avatar_color":"#FF4392","options":{"allows_free_text":false,"has_settings":true}},{"id":"3288655325539870083","pagination_id":"03401241960135009496","display_name":"SPDR S\u0026P 500 ETF","short_display_name":"SPY","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to sell to close 1 contract of SPY $674.00 Call 11/6 has been filled for an average price of $46.00 per contract. \n\nYour order is complete.","attributes":null},"most_recent_message":{"id":"3401241960135009496","thread_id":"3288655325539870083","response_message_id":null,"message_type_config_id":"982","message_config_id":"3370953","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"SPDR S\u0026P 500 ETF","short_display_name":"SPY","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to sell to close 1 contract of SPY $674.00 Call 11/6 has been filled for an average price of $46.00 per contract. \n\nYour order is complete.","attributes":null},"action":{"value":"622451","display_text":"View Order","url":"robinhood://orders?id=690cf9b4-7e2f-449d-b31b-6864d8cafb8b\u0026type=option"},"media":null,"remote_medias":[],"responses":[{"display_text":"I'd like to place a new order. 😎","answer":"239170"},{"display_text":"Hooray! 🙌","answer":"238725"}],"created_at":"2025-11-06T19:40:37.658371Z","updated_at":"2025-11-06T19:40:37.658371Z"},"last_message_sent_at":"2025-11-06T19:40:37.658371Z","avatar_url":null,"entity_url":"robinhood://instrument?id=8f92e76f-1e0e-4478-8580-16a6ffcfaef5","avatar_color":"#0B972E","options":{"allows_free_text":false,"has_settings":true}},{"id":"3282498147045090427","pagination_id":"03282498147154142332","display_name":"Perspective Therapeutics","short_display_name":"CATX","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to buy 50 shares of CATX through your individual account was canceled.","attributes":null},"most_recent_message":{"id":"3282498147154142332","thread_id":"3282498147045090427","response_message_id":null,"message_type_config_id":"2350","message_config_id":"3371539","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Perspective Therapeutics","short_display_name":"CATX","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to buy 50 shares of CATX through your individual account was canceled.","attributes":null},"action":null,"media":null,"remote_medias":[],"responses":[{"display_text":"Can I see more details? 🤓","answer":"238736"},{"display_text":"I'd like to place a new order.","answer":"238738"}],"created_at":"2025-05-26T23:37:52.070033Z","updated_at":"2025-05-26T23:37:52.070033Z"},"last_message_sent_at":"2025-05-26T23:37:52.070033Z","avatar_url":null,"entity_url":"robinhood://instrument?id=90f6a1e5-5f78-44ed-af9f-5ff677cba3da","avatar_color":"#9571FD","options":{"allows_free_text":false,"has_settings":true}},{"id":"3354020397417767945","pagination_id":"03360156034143364336","display_name":"Figure Technology Solutions","short_display_name":"FIGR","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"FIGR finalized its price to $25.00. You can submit a request for initial public offering (IPO) shares. \n\nYou have until September 11th, 2025 at 12:30 AM to submit your request.","attributes":null},"most_recent_message":{"id":"3360156034143364336","thread_id":"3354020397417767945","response_message_id":null,"message_type_config_id":"2590d21f-997b-46a1-808b-da21f94da1b0","message_config_id":"3371573","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Figure Technology Solutions","short_display_name":"FIGR","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"FIGR finalized its price to $25.00. You can submit a request for initial public offering (IPO) shares. \n\nYou have until September 11th, 2025 at 12:30 AM to submit your request.","attributes":null},"action":{"value":"622466","display_text":"Request shares","url":"robinhood://ipo_access_notification_disclosure?id=92c98608-db55-408e-b2eb-b0c6d7f3baa7\u0026destination=enter_ipo_access_order\u0026source=inbox_deeplink"},"media":null,"remote_medias":[],"responses":[],"created_at":"2025-09-11T03:10:13.609364Z","updated_at":"2025-09-11T03:10:13.609364Z"},"last_message_sent_at":"2025-09-11T03:10:13.609364Z","avatar_url":null,"entity_url":"robinhood://instrument?id=92c98608-db55-408e-b2eb-b0c6d7f3baa7","avatar_color":"#D45BFF","options":{"allows_free_text":false,"has_settings":true}},{"id":"3399171539164210990","pagination_id":"03399171539231319056","display_name":"Gloo Holdings","short_display_name":"GLOO","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Gloo Holdings Inc (GLOO) plans to go public. You can now find GLOO in the IPO Access list and review the prospectus.","attributes":null},"most_recent_message":{"id":"3399171539231319056","thread_id":"3399171539164210990","response_message_id":null,"message_type_config_id":"cbb44db5-e91c-4754-81de-cfc9122e2fa0","message_config_id":"5875937","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Gloo Holdings","short_display_name":"GLOO","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Gloo Holdings Inc (GLOO) plans to go public. You can now find GLOO in the IPO Access list and review the prospectus.","attributes":null},"action":{"value":"1026854","display_text":"View list","url":"robinhood://lists?id=8ce9f620-5bb0-4b6a-8c61-5a06763f7a8b\u0026owner_type=robinhood\u0026popover_ipo_announcement_id=93c1d1fa-a34d-4529-94b8-c95de4049fe4"},"media":null,"remote_medias":[],"responses":[],"created_at":"2025-11-03T23:07:04.252646Z","updated_at":"2025-11-03T23:07:04.252646Z"},"last_message_sent_at":"2025-11-03T23:07:04.252646Z","avatar_url":null,"entity_url":"robinhood://instrument?id=93c1d1fa-a34d-4529-94b8-c95de4049fe4","avatar_color":"#FB7137","options":{"allows_free_text":false,"has_settings":true}},{"id":"3354061913200796858","pagination_id":"03360842758913795746","display_name":"Gemini Space Station","short_display_name":"GEMI","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"GEMI finalized its price to $28.00. You can submit a request for initial public offering (IPO) shares. \n\nYou have until September 11th, 2025 at 11:59 PM to submit your request.","attributes":null},"most_recent_message":{"id":"3360842758913795746","thread_id":"3354061913200796858","response_message_id":null,"message_type_config_id":"2590d21f-997b-46a1-808b-da21f94da1b0","message_config_id":"3371573","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Gemini Space Station","short_display_name":"GEMI","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"GEMI finalized its price to $28.00. You can submit a request for initial public offering (IPO) shares. \n\nYou have until September 11th, 2025 at 11:59 PM to submit your request.","attributes":null},"action":{"value":"622466","display_text":"Request shares","url":"robinhood://ipo_access_notification_disclosure?id=99c35654-7c80-407b-b045-ecc098a3c658\u0026destination=enter_ipo_access_order\u0026source=inbox_deeplink"},"media":null,"remote_medias":[],"responses":[],"created_at":"2025-09-12T01:54:37.581762Z","updated_at":"2025-09-12T01:54:37.581762Z"},"last_message_sent_at":"2025-09-12T01:54:37.581762Z","avatar_url":null,"entity_url":"robinhood://instrument?id=99c35654-7c80-407b-b045-ecc098a3c658","avatar_color":"#00C000","options":{"allows_free_text":false,"has_settings":true}},{"id":"3402021798731064805","pagination_id":"03402021821279642796","display_name":"Take-Two Interactive Software","short_display_name":"TTWO","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to buy to open 1 contract of TTWO $320.00 Call 9/18/2026 in your individual (•••2153) account wasn't filled today, and has been automatically canceled.","attributes":null},"most_recent_message":{"id":"3402021821279642796","thread_id":"3402021798731064805","response_message_id":null,"message_type_config_id":"903","message_config_id":"3372481","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Take-Two Interactive Software","short_display_name":"TTWO","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to buy to open 1 contract of TTWO $320.00 Call 9/18/2026 in your individual (•••2153) account wasn't filled today, and has been automatically canceled.","attributes":null},"action":null,"media":null,"remote_medias":[],"responses":[{"display_text":"Can I see more details? 🤓","answer":"239173"},{"display_text":"I'd like to replace this order. 🙂","answer":"239166"}],"created_at":"2025-11-07T21:30:04.348366Z","updated_at":"2025-11-07T21:30:04.348366Z"},"last_message_sent_at":"2025-11-07T21:30:04.348366Z","avatar_url":null,"entity_url":"robinhood://instrument?id=9fac6c12-bdb8-4420-a85f-52920971e7ba","avatar_color":"#007BC4","options":{"allows_free_text":false,"has_settings":true}},{"id":"3283105743502320989","pagination_id":"03288736000762717246","display_name":"Kingsoft Cloud","short_display_name":"KC","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to sell 9 shares of KC through your individual account has been filled at an average price of $11.43 per share.\n\nYour order is complete.","attributes":null},"most_recent_message":{"id":"3288736000762717246","thread_id":"3283105743502320989","response_message_id":null,"message_type_config_id":"2765","message_config_id":"3370914","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Kingsoft Cloud","short_display_name":"KC","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to sell 9 shares of KC through your individual account has been filled at an average price of $11.43 per share.\n\nYour order is complete.","attributes":null},"action":null,"media":null,"remote_medias":[],"responses":[{"display_text":"Can I see more details? 🤓","answer":"238736"},{"display_text":"I'd like to place a new order.","answer":"238738"}],"created_at":"2025-06-04T14:11:22.17076Z","updated_at":"2025-06-04T14:11:22.17076Z"},"last_message_sent_at":"2025-06-04T14:11:22.17076Z","avatar_url":null,"entity_url":"robinhood://instrument?id=a1f2c41a-8563-4d57-b7bc-a6a4c544d436","avatar_color":"#00C000","options":{"allows_free_text":false,"has_settings":true}},{"id":"3278590591906096425","pagination_id":"03350356362218448117","display_name":"NVIDIA","short_display_name":"NVDA","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to sell to close 2 contracts of NVDA $207.50 Call 9/5 has been filled for an average price of $8.00 per contract. \n\nYour order is complete.","attributes":null},"most_recent_message":{"id":"3350356362218448117","thread_id":"3278590591906096425","response_message_id":null,"message_type_config_id":"982","message_config_id":"3370953","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"NVIDIA","short_display_name":"NVDA","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to sell to close 2 contracts of NVDA $207.50 Call 9/5 has been filled for an average price of $8.00 per contract. \n\nYour order is complete.","attributes":null},"action":{"value":"622451","display_text":"View Order","url":"robinhood://orders?id=68b06a3f-b9f5-4f19-b8f3-696016697e3a\u0026type=option"},"media":null,"remote_medias":[],"responses":[{"display_text":"I'd like to place a new order. 😎","answer":"239170"},{"display_text":"Hooray! 🙌","answer":"238725"}],"created_at":"2025-08-28T14:40:01.68126Z","updated_at":"2025-08-28T14:40:01.68126Z"},"last_message_sent_at":"2025-08-28T14:40:01.68126Z","avatar_url":null,"entity_url":"robinhood://instrument?id=a4ecd608-e7b4-4ff3-afa5-f77ae7632dfb","avatar_color":"#76B900","options":{"allows_free_text":false,"has_settings":true}},{"id":"3359819176528061537","pagination_id":"03390986116227147215","display_name":"Pattern Group Inc.","short_display_name":"PTRN","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to sell 1 share of PTRN through your individual (•••2153) account has been filled at an average price of $14.73 per share.\n\nYour order is complete.","attributes":null},"most_recent_message":{"id":"3390986116227147215","thread_id":"3359819176528061537","response_message_id":null,"message_type_config_id":"2765","message_config_id":"3370914","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Pattern Group Inc.","short_display_name":"PTRN","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to sell 1 share of PTRN through your individual (•••2153) account has been filled at an average price of $14.73 per share.\n\nYour order is complete.","attributes":null},"action":null,"media":null,"remote_medias":[],"responses":[{"display_text":"Can I see more details? 🤓","answer":"238736"},{"display_text":"I'd like to place a new order.","answer":"238738"}],"created_at":"2025-10-23T16:04:05.789099Z","updated_at":"2025-10-23T16:04:05.789099Z"},"last_message_sent_at":"2025-10-23T16:04:05.789099Z","avatar_url":null,"entity_url":"robinhood://instrument?id=a69d3678-3e6a-46ec-9e64-fe1b2a6f1f52","avatar_color":"#9571FD","options":{"allows_free_text":false,"has_settings":true}},{"id":"3282939711022179623","pagination_id":"03284339702982780511","display_name":"Rivian Automotive","short_display_name":"RIVN","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to sell 20 shares of RIVN through your individual account has been filled at an average price of $15.68 per share.\n\nYour order is complete.","attributes":null},"most_recent_message":{"id":"3284339702982780511","thread_id":"3282939711022179623","response_message_id":null,"message_type_config_id":"2639","message_config_id":"3370914","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Rivian Automotive","short_display_name":"RIVN","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to sell 20 shares of RIVN through your individual account has been filled at an average price of $15.68 per share.\n\nYour order is complete.","attributes":null},"action":null,"media":null,"remote_medias":[],"responses":[{"display_text":"Can I see more details? 🤓","answer":"238736"},{"display_text":"I'd like to place a new order.","answer":"238738"}],"created_at":"2025-05-29T12:36:42.635183Z","updated_at":"2025-05-29T12:36:42.635183Z"},"last_message_sent_at":"2025-05-29T12:36:42.635183Z","avatar_url":null,"entity_url":"robinhood://instrument?id=acc0099d-bae4-4589-936c-e36c5c5321ed","avatar_color":"#DB50C8","options":{"allows_free_text":false,"has_settings":true}},{"id":"3325734249771837050","pagination_id":"03327956930160240469","display_name":"Intel","short_display_name":"INTC","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to sell to close 1 contract of INTC $20.00 Put 8/15 has been filled for an average price of $34.00 per contract. \n\nYour order is complete.","attributes":null},"most_recent_message":{"id":"3327956930160240469","thread_id":"3325734249771837050","response_message_id":null,"message_type_config_id":"948","message_config_id":"3370953","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Intel","short_display_name":"INTC","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to sell to close 1 contract of INTC $20.00 Put 8/15 has been filled for an average price of $34.00 per contract. \n\nYour order is complete.","attributes":null},"action":{"value":"622451","display_text":"View Order","url":"robinhood://orders?id=6887ab8f-53aa-4210-bc6e-25859fe1d3a9\u0026type=option"},"media":null,"remote_medias":[],"responses":[{"display_text":"I'd like to place a new order. 😎","answer":"239170"},{"display_text":"Hooray! 🙌","answer":"238725"}],"created_at":"2025-07-28T16:56:21.295228Z","updated_at":"2025-07-28T16:56:21.295228Z"},"last_message_sent_at":"2025-07-28T16:56:21.295228Z","avatar_url":null,"entity_url":"robinhood://instrument?id=ad059c69-0c1c-4c6b-8322-f53f1bbd69d4","avatar_color":"#0F7DC2","options":{"allows_free_text":false,"has_settings":true}},{"id":"3358375908862863265","pagination_id":"03364450158493312869","display_name":"StubHub","short_display_name":"STUB","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"STUB finalized its price to $23.50. You can submit a request for initial public offering (IPO) shares. \n\nYou have until September 16th, 2025 at 11:59 PM to submit your request.","attributes":null},"most_recent_message":{"id":"3364450158493312869","thread_id":"3358375908862863265","response_message_id":null,"message_type_config_id":"2590d21f-997b-46a1-808b-da21f94da1b0","message_config_id":"3371573","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"StubHub","short_display_name":"STUB","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"STUB finalized its price to $23.50. You can submit a request for initial public offering (IPO) shares. \n\nYou have until September 16th, 2025 at 11:59 PM to submit your request.","attributes":null},"action":{"value":"622466","display_text":"Request shares","url":"robinhood://ipo_access_notification_disclosure?id=b11a8b61-c6c7-4950-8982-f8930ec0142e\u0026destination=enter_ipo_access_order\u0026source=inbox_deeplink"},"media":null,"remote_medias":[],"responses":[],"created_at":"2025-09-17T01:21:53.119569Z","updated_at":"2025-09-17T01:21:53.119569Z"},"last_message_sent_at":"2025-09-17T01:21:53.119569Z","avatar_url":null,"entity_url":"robinhood://instrument?id=b11a8b61-c6c7-4950-8982-f8930ec0142e","avatar_color":"#FFDB1F","options":{"allows_free_text":false,"has_settings":true}},{"id":"3354979376138561196","pagination_id":"03360898488807204528","display_name":"Via Transportation","short_display_name":"VIA","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"VIA finalized its price to $46.00. You can submit a request for initial public offering (IPO) shares. \n\nYou have until September 12th, 2025 at 1:00 AM to submit your request.","attributes":null},"most_recent_message":{"id":"3360898488807204528","thread_id":"3354979376138561196","response_message_id":null,"message_type_config_id":"2590d21f-997b-46a1-808b-da21f94da1b0","message_config_id":"3371573","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Via Transportation","short_display_name":"VIA","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"VIA finalized its price to $46.00. You can submit a request for initial public offering (IPO) shares. \n\nYou have until September 12th, 2025 at 1:00 AM to submit your request.","attributes":null},"action":{"value":"622466","display_text":"Request shares","url":"robinhood://ipo_access_notification_disclosure?id=b670f036-8739-4f54-8e32-6129f76f69c6\u0026destination=enter_ipo_access_order\u0026source=inbox_deeplink"},"media":null,"remote_medias":[],"responses":[],"created_at":"2025-09-12T03:45:21.102957Z","updated_at":"2025-09-12T03:45:21.102957Z"},"last_message_sent_at":"2025-09-12T03:45:21.102957Z","avatar_url":null,"entity_url":"robinhood://instrument?id=b670f036-8739-4f54-8e32-6129f76f69c6","avatar_color":"#DB50C8","options":{"allows_free_text":false,"has_settings":true}},{"id":"3312844222788281360","pagination_id":"03319930029978167284","display_name":"Coca-Cola","short_display_name":"KO","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"You've canceled your order to buy to open 100 contracts of KO $110.00 Call 1/15/2027 in your individual account.","attributes":null},"most_recent_message":{"id":"3319930029978167284","thread_id":"3312844222788281360","response_message_id":null,"message_type_config_id":"917","message_config_id":"3372575","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Coca-Cola","short_display_name":"KO","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"You've canceled your order to buy to open 100 contracts of KO $110.00 Call 1/15/2027 in your individual account.","attributes":null},"action":null,"media":null,"remote_medias":[],"responses":[{"display_text":"Can I see more details? 🤓","answer":"239173"},{"display_text":"I'd like to replace this order. 🙂","answer":"239166"}],"created_at":"2025-07-17T15:08:20.227303Z","updated_at":"2025-07-17T15:08:20.227303Z"},"last_message_sent_at":"2025-07-17T15:08:20.227303Z","avatar_url":null,"entity_url":"robinhood://instrument?id=bb9a01df-5982-42d4-88db-8662f23cdab5","avatar_color":"#EE3215","options":{"allows_free_text":false,"has_settings":true}},{"id":"3368511213548872912","pagination_id":"03369239599837619321","display_name":"Amazon","short_display_name":"AMZN","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to sell 3 shares of AMZN through your individual (•••2153) account has been filled at an average price of $222.41 per share.\n\nYour order is complete.","attributes":null},"most_recent_message":{"id":"3369239599837619321","thread_id":"3368511213548872912","response_message_id":null,"message_type_config_id":"2654","message_config_id":"3370914","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Amazon","short_display_name":"AMZN","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to sell 3 shares of AMZN through your individual (•••2153) account has been filled at an average price of $222.41 per share.\n\nYour order is complete.","attributes":null},"action":null,"media":null,"remote_medias":[],"responses":[{"display_text":"Can I see more details? 🤓","answer":"238736"},{"display_text":"I'd like to place a new order.","answer":"238738"}],"created_at":"2025-09-23T15:57:39.022572Z","updated_at":"2025-09-23T15:57:39.022572Z"},"last_message_sent_at":"2025-09-23T15:57:39.022572Z","avatar_url":null,"entity_url":"robinhood://instrument?id=c0bb3aec-bd1e-471e-a4f0-ca011cbec711","avatar_color":"#FC9A28","options":{"allows_free_text":false,"has_settings":true}},{"id":"3303866990451500760","pagination_id":"03303867089143473630","display_name":"United States Oil Fund","short_display_name":"USO","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"You've canceled your order to buy to open 1 contract of USO $71.00 Put 7/2 in your individual account.","attributes":null},"most_recent_message":{"id":"3303867089143473630","thread_id":"3303866990451500760","response_message_id":null,"message_type_config_id":"866","message_config_id":"3372575","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"United States Oil Fund","short_display_name":"USO","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"You've canceled your order to buy to open 1 contract of USO $71.00 Put 7/2 in your individual account.","attributes":null},"action":null,"media":null,"remote_medias":[],"responses":[{"display_text":"Can I see more details? 🤓","answer":"239173"},{"display_text":"I'd like to replace this order. 🙂","answer":"239166"}],"created_at":"2025-06-25T11:14:08.467065Z","updated_at":"2025-06-25T11:14:08.467065Z"},"last_message_sent_at":"2025-06-25T11:14:08.467065Z","avatar_url":null,"entity_url":"robinhood://instrument?id=cb39e60a-dfc6-44db-89b4-980d7aea608c","avatar_color":"#FF4392","options":{"allows_free_text":false,"has_settings":true}},{"id":"3369930737091355714","pagination_id":"03385900050105247079","display_name":"Fermi","short_display_name":"FRMI","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to sell 12 shares of FRMI through your individual (•••2153) account has been filled at an average price of $30.00 per share.\n\nYour order is complete.","attributes":null},"most_recent_message":{"id":"3385900050105247079","thread_id":"3369930737091355714","response_message_id":null,"message_type_config_id":"2654","message_config_id":"3370914","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Fermi","short_display_name":"FRMI","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to sell 12 shares of FRMI through your individual (•••2153) account has been filled at an average price of $30.00 per share.\n\nYour order is complete.","attributes":null},"action":null,"media":null,"remote_medias":[],"responses":[{"display_text":"Can I see more details? 🤓","answer":"238736"},{"display_text":"I'd like to place a new order.","answer":"238738"}],"created_at":"2025-10-16T15:38:59.460479Z","updated_at":"2025-10-16T15:38:59.460479Z"},"last_message_sent_at":"2025-10-16T15:38:59.460479Z","avatar_url":null,"entity_url":"robinhood://instrument?id=d1a739f8-6cb8-4a4c-95ab-ace9613b4b2b","avatar_color":"#FB7137","options":{"allows_free_text":false,"has_settings":true}},{"id":"3343078756074923664","pagination_id":"03344534457141961908","display_name":"Roblox","short_display_name":"RBLX","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to sell to close 1 contract of RBLX $118.00 Put 8/22 has been filled for an average price of $370.00 per contract. \n\nYour order is complete.","attributes":null},"most_recent_message":{"id":"3344534457141961908","thread_id":"3343078756074923664","response_message_id":null,"message_type_config_id":"948","message_config_id":"3370953","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Roblox","short_display_name":"RBLX","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to sell to close 1 contract of RBLX $118.00 Put 8/22 has been filled for an average price of $370.00 per contract. \n\nYour order is complete.","attributes":null},"action":{"value":"622451","display_text":"View Order","url":"robinhood://orders?id=68a5d32f-4af7-4635-995e-ea941039af93\u0026type=option"},"media":null,"remote_medias":[],"responses":[{"display_text":"I'd like to place a new order. 😎","answer":"239170"},{"display_text":"Hooray! 🙌","answer":"238725"}],"created_at":"2025-08-20T13:52:56.513267Z","updated_at":"2025-08-20T13:52:56.513267Z"},"last_message_sent_at":"2025-08-20T13:52:56.513267Z","avatar_url":null,"entity_url":"robinhood://instrument?id=dd770da4-6ee8-4429-99f3-b0b5f965f50a","avatar_color":"#00C000","options":{"allows_free_text":false,"has_settings":true}},{"id":"3282416736694969803","pagination_id":"03282416736787244732","display_name":"Ocean Power Technologies","short_display_name":"OPTT","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to buy 300 shares of OPTT through your individual account was canceled.","attributes":null},"most_recent_message":{"id":"3282416736787244732","thread_id":"3282416736694969803","response_message_id":null,"message_type_config_id":"2350","message_config_id":"3371539","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Ocean Power Technologies","short_display_name":"OPTT","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to buy 300 shares of OPTT through your individual account was canceled.","attributes":null},"action":null,"media":null,"remote_medias":[],"responses":[{"display_text":"Can I see more details? 🤓","answer":"238736"},{"display_text":"I'd like to place a new order.","answer":"238738"}],"created_at":"2025-05-26T20:56:07.201723Z","updated_at":"2025-05-26T20:56:07.201723Z"},"last_message_sent_at":"2025-05-26T20:56:07.201723Z","avatar_url":null,"entity_url":"robinhood://instrument?id=df43c301-2419-43f4-b172-736ad80cb112","avatar_color":"#D45BFF","options":{"allows_free_text":false,"has_settings":true}},{"id":"3279253807426447176","pagination_id":"03319947390084981857","display_name":"Tesla","short_display_name":"TSLA","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to sell to close 1 contract of TSLA $310.00 Put 7/18 has been filled for an average price of $43.00 per contract. \n\nYour order is complete.","attributes":null},"most_recent_message":{"id":"3319947390084981857","thread_id":"3279253807426447176","response_message_id":null,"message_type_config_id":"948","message_config_id":"3370953","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Tesla","short_display_name":"TSLA","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to sell to close 1 contract of TSLA $310.00 Put 7/18 has been filled for an average price of $43.00 per contract. \n\nYour order is complete.","attributes":null},"action":{"value":"622451","display_text":"View Order","url":"robinhood://orders?id=687919f7-6ee4-45f3-b134-79475ca5d4c6\u0026type=option"},"media":null,"remote_medias":[],"responses":[{"display_text":"I'd like to place a new order. 😎","answer":"239170"},{"display_text":"Hooray! 🙌","answer":"238725"}],"created_at":"2025-07-17T15:42:49.717978Z","updated_at":"2025-07-17T15:42:49.717978Z"},"last_message_sent_at":"2025-07-17T15:42:49.717978Z","avatar_url":null,"entity_url":"robinhood://instrument?id=e39ed23a-7bd1-4587-b060-71988d9ef483","avatar_color":"#EE3215","options":{"allows_free_text":false,"has_settings":true}},{"id":"3293337296207620023","pagination_id":"03309847342634510086","display_name":"Warner Bros. Discovery","short_display_name":"WBD","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to buy to open 100 contracts of WBD $25.00 Call 1/15/2027 in your individual account wasn't filled today, and has been automatically canceled.","attributes":null},"most_recent_message":{"id":"3309847342634510086","thread_id":"3293337296207620023","response_message_id":null,"message_type_config_id":"903","message_config_id":"3372481","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Warner Bros. Discovery","short_display_name":"WBD","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to buy to open 100 contracts of WBD $25.00 Call 1/15/2027 in your individual account wasn't filled today, and has been automatically canceled.","attributes":null},"action":null,"media":null,"remote_medias":[],"responses":[{"display_text":"Can I see more details? 🤓","answer":"239173"},{"display_text":"I'd like to replace this order. 🙂","answer":"239166"}],"created_at":"2025-07-03T17:15:50.236693Z","updated_at":"2025-07-03T17:15:50.236693Z"},"last_message_sent_at":"2025-07-03T17:15:50.236693Z","avatar_url":null,"entity_url":"robinhood://instrument?id=e85a9b9d-6702-449b-a12f-18611e95719c","avatar_color":"#70D4FF","options":{"allows_free_text":false,"has_settings":true}},{"id":"3333127180392604988","pagination_id":"03339576393720669476","display_name":"Bullish","short_display_name":"BLSH","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Your order to sell 1 share of BLSH through your individual account has been filled at an average price of $92.74 per share.\n\nYour order is complete.","attributes":null},"most_recent_message":{"id":"3339576393720669476","thread_id":"3333127180392604988","response_message_id":null,"message_type_config_id":"2765","message_config_id":"3370914","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Bullish","short_display_name":"BLSH","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Your order to sell 1 share of BLSH through your individual account has been filled at an average price of $92.74 per share.\n\nYour order is complete.","attributes":null},"action":null,"media":null,"remote_medias":[],"responses":[{"display_text":"Can I see more details? 🤓","answer":"238736"},{"display_text":"I'd like to place a new order.","answer":"238738"}],"created_at":"2025-08-13T17:42:09.295114Z","updated_at":"2025-08-13T17:42:09.295114Z"},"last_message_sent_at":"2025-08-13T17:42:09.295114Z","avatar_url":null,"entity_url":"robinhood://instrument?id=f87f301c-f18a-43d7-820a-66b30ac443e3","avatar_color":"#DB50C8","options":{"allows_free_text":false,"has_settings":true}},{"id":"3297442397620806827","pagination_id":"03299676482187569143","display_name":"Palantir Technologies","short_display_name":"PLTR","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"You've canceled your order to buy to open 1 contract of PLTR $139.00 Put 6/20 in your individual account.","attributes":null},"most_recent_message":{"id":"3299676482187569143","thread_id":"3297442397620806827","response_message_id":null,"message_type_config_id":"880","message_config_id":"3372575","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Palantir Technologies","short_display_name":"PLTR","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"You've canceled your order to buy to open 1 contract of PLTR $139.00 Put 6/20 in your individual account.","attributes":null},"action":null,"media":null,"remote_medias":[],"responses":[{"display_text":"Can I see more details? 🤓","answer":"239173"},{"display_text":"I'd like to replace this order. 🙂","answer":"239166"}],"created_at":"2025-06-19T16:28:09.189207Z","updated_at":"2025-06-19T16:28:09.189207Z"},"last_message_sent_at":"2025-06-19T16:28:09.189207Z","avatar_url":null,"entity_url":"robinhood://instrument?id=f90de184-4f73-4aad-9a5f-407858013eb1","avatar_color":"#FFDB1F","options":{"allows_free_text":false,"has_settings":true}},{"id":"3389534942340851222","pagination_id":"03389534942391183079","display_name":"Navan","short_display_name":"NAVN","is_read":false,"is_critical":false,"is_muted":false,"preview_text":{"text":"Navan, Inc. (NAVN) plans to go public. You can now find NAVN in the IPO Access list and review the prospectus.","attributes":null},"most_recent_message":{"id":"3389534942391183079","thread_id":"3389534942340851222","response_message_id":null,"message_type_config_id":"331941c5-acbc-415b-9095-3fe12eade2d0","message_config_id":"5749989","sender":{"id":"12345678-1234-1234-1234-123451234512","display_name":"Navan","short_display_name":"NAVN","is_bot":true,"avatar_url":"https://cdn.robinhood.com/inbox_image_asset/robinhood_message_avatar.png"},"is_metadata":false,"rich_text":{"text":"Navan, Inc. (NAVN) plans to go public. You can now find NAVN in the IPO Access list and review the prospectus.","attributes":null},"action":{"value":"1006289","display_text":"View list","url":"robinhood://lists?id=8ce9f620-5bb0-4b6a-8c61-5a06763f7a8b\u0026owner_type=robinhood\u0026popover_ipo_announcement_id=fb36a2c0-c9fb-4405-9041-bc1340a5788b"},"media":null,"remote_medias":[],"responses":[],"created_at":"2025-10-21T16:00:52.39026Z","updated_at":"2025-10-21T16:00:52.39026Z"},"last_message_sent_at":"2025-10-21T16:00:52.39026Z","avatar_url":null,"entity_url":"robinhood://instrument?id=fb36a2c0-c9fb-4405-9041-bc1340a5788b","avatar_color":"#DB50C8","options":{"allows_free_text":false,"has_settings":true}}],"next":null}

Request URL
https://api.robinhood.com/inbox/threads/
Request Method
GET
Status Code
200 OK
Remote Address
[2607:7700:0:f::3455:4e09]:443
Referrer Policy
strict-origin-when-cross-origin
access-control-allow-credentials
true
access-control-allow-origin
https://robinhood.com
content-type
application/json
date
Mon, 10 Nov 2025 07:49:35 GMT
server
envoy
vary
Origin
via
1.1 9cb117ffd0084af75a386e8260599f28.cloudfront.net (CloudFront)
x-amz-cf-id
tjizl5CNk2guTiZl1H7ZMz6s4uY-Mre7D7OEaMmMuHIHNSNPW6Huaw==
x-amz-cf-pop
MIA50-P6
x-cache
Miss from cloudfront
x-poll-interval
10
:authority
api.robinhood.com
:method
GET
:path
/inbox/threads/
:scheme
https
accept
*/*
accept-encoding
gzip, deflate, br, zstd
accept-language
en-US,en;q=0.9
authorization
Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6IjIiLCJ0eXAiOiJKV1QifQ.eyJkY3QiOjE3NjI3NTkzNzIsImRldmljZV9oYXNoIjoiMTU1YTMxMTRiYTM1ZjI3NzMwODc5ZjRjYjljMDc2MjQiLCJleHAiOjE3NjUzMDA5MzQsImlzcyI6Imh0dHBzOi8vYXBpLnJvYmluaG9vZC5jb20iLCJsZXZlbDJfYWNjZXNzIjp0cnVlLCJtZXRhIjp7Im9pZCI6ImM4MlNIMFdaT3NhYk9YR1Ayc3hxY2ozNEZ4a3ZmbldSWkJLbEJqRlMiLCJvbiI6IlJvYmluaG9vZCJ9LCJvcHRpb25zIjp0cnVlLCJwb3MiOiJwIiwic2NvcGUiOiJpbnRlcm5hbCIsInNlcnZpY2VfcmVjb3JkcyI6W3siaGFsdGVkIjpmYWxzZSwic2VydmljZSI6ImNlcmVzX3VzIiwic2hhcmRfaWQiOjEsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoibnVtbXVzX3VzIiwic2hhcmRfaWQiOjIsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoiYnJva2ViYWNrX3VzIiwic2hhcmRfaWQiOjEzLCJzdGF0ZSI6ImF2YWlsYWJsZSJ9XSwic2xnIjoxLCJzbHMiOiJrTU5CcGdDaldRTmNiaURiSGtXS2M2NGhleDd5dzdUVWdVN2ZxY1VoRmdXcGNHUTQwVmgxbmU0ZE5CWHVzT3duOEU4d3J2eHBsbFRqU3lFVDU2bk9EZz09Iiwic3JtIjp7ImIiOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjEzfSwiYyI6eyJobCI6ZmFsc2UsInIiOiJ1cyIsInNpZCI6MX0sIm4iOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjJ9fSwidG9rZW4iOiJ3ZTlzNXpMSE5NclpkUDVRZHJxYWN6TFc0c3NmQmYiLCJ1c2VyX2lkIjoiYzY1ZmQyNTItYjg2NC00ZjBlLWE3NjctYmE0ZjJiZTMyZDcxIiwidXNlcl9vcmlnaW4iOiJVUyJ9.awcwoeCbk8VzAGSmcaF736sufIFjCXRefpKQb5noJIXwKuSIeO-YzALaam2HEAlIf1tMSckAZSsAttV-O0S1-w
origin
https://robinhood.com
priority
u=1, i
referer
https://robinhood.com/
sec-ch-ua
"Chromium";v="141", "Not?A_Brand";v="8"
sec-ch-ua-mobile
?0
sec-ch-ua-platform
"Windows"
sec-fetch-dest
empty
sec-fetch-mode
cors
sec-fetch-site
same-site
user-agent
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36


Peticion 2:
https://api.robinhood.com/discovery/lists/items/?list_id=12442aa7-2280-4d5a-86e4-1ee5353f3892&local_midnight=2025-11-10T05%3A00%3A00.000Z

fetch("https://api.robinhood.com/discovery/lists/items/?list_id=12442aa7-2280-4d5a-86e4-1ee5353f3892&local_midnight=2025-11-10T05%3A00%3A00.000Z", {
  "headers": {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "authorization": "Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6IjIiLCJ0eXAiOiJKV1QifQ.eyJkY3QiOjE3NjI3NTkzNzIsImRldmljZV9oYXNoIjoiMTU1YTMxMTRiYTM1ZjI3NzMwODc5ZjRjYjljMDc2MjQiLCJleHAiOjE3NjUzMDA5MzQsImlzcyI6Imh0dHBzOi8vYXBpLnJvYmluaG9vZC5jb20iLCJsZXZlbDJfYWNjZXNzIjp0cnVlLCJtZXRhIjp7Im9pZCI6ImM4MlNIMFdaT3NhYk9YR1Ayc3hxY2ozNEZ4a3ZmbldSWkJLbEJqRlMiLCJvbiI6IlJvYmluaG9vZCJ9LCJvcHRpb25zIjp0cnVlLCJwb3MiOiJwIiwic2NvcGUiOiJpbnRlcm5hbCIsInNlcnZpY2VfcmVjb3JkcyI6W3siaGFsdGVkIjpmYWxzZSwic2VydmljZSI6ImNlcmVzX3VzIiwic2hhcmRfaWQiOjEsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoibnVtbXVzX3VzIiwic2hhcmRfaWQiOjIsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoiYnJva2ViYWNrX3VzIiwic2hhcmRfaWQiOjEzLCJzdGF0ZSI6ImF2YWlsYWJsZSJ9XSwic2xnIjoxLCJzbHMiOiJrTU5CcGdDaldRTmNiaURiSGtXS2M2NGhleDd5dzdUVWdVN2ZxY1VoRmdXcGNHUTQwVmgxbmU0ZE5CWHVzT3duOEU4d3J2eHBsbFRqU3lFVDU2bk9EZz09Iiwic3JtIjp7ImIiOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjEzfSwiYyI6eyJobCI6ZmFsc2UsInIiOiJ1cyIsInNpZCI6MX0sIm4iOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjJ9fSwidG9rZW4iOiJ3ZTlzNXpMSE5NclpkUDVRZHJxYWN6TFc0c3NmQmYiLCJ1c2VyX2lkIjoiYzY1ZmQyNTItYjg2NC00ZjBlLWE3NjctYmE0ZjJiZTMyZDcxIiwidXNlcl9vcmlnaW4iOiJVUyJ9.awcwoeCbk8VzAGSmcaF736sufIFjCXRefpKQb5noJIXwKuSIeO-YzALaam2HEAlIf1tMSckAZSsAttV-O0S1-w",
    "priority": "u=1, i",
    "sec-ch-ua": "\"Chromium\";v=\"141\", \"Not?A_Brand\";v=\"8\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "x-hyper-ex": "enabled",
    "x-midlands-api-version": "1.66.64",
    "x-timezone-id": "America/New_York",
    "Referer": "https://robinhood.com/"
  },
  "body": null,
  "method": "GET"
});

list_id=12442aa7-2280-4d5a-86e4-1ee5353f3892&local_midnight=2025-11-10T05%3A00%3A00.000Z

Request URL
https://api.robinhood.com/discovery/lists/items/?list_id=12442aa7-2280-4d5a-86e4-1ee5353f3892&local_midnight=2025-11-10T05%3A00%3A00.000Z
Request Method
GET
Status Code
200 OK
Remote Address
[2607:7700:0:f::3455:4e09]:443
Referrer Policy
strict-origin-when-cross-origin
access-control-allow-credentials
true
access-control-allow-origin
https://robinhood.com
allow
GET, POST, HEAD, OPTIONS
content-language
en-us
content-length
24985
content-type
application/json
date
Mon, 10 Nov 2025 07:49:37 GMT
server
envoy
trace-uuid
6f1f3a3b-bb73-4b76-8da5-fb164ffb3972
vary
Accept-Language, Origin
via
1.1 9cb117ffd0084af75a386e8260599f28.cloudfront.net (CloudFront)
x-amz-cf-id
DtNVhV8wVtzffAicf8ztkGu0u8i3Cf41k2M9cERv0UGT0kQSNjvPbQ==
x-amz-cf-pop
MIA50-P6
x-cache
Miss from cloudfront
:authority
api.robinhood.com
:method
GET
:path
/discovery/lists/items/?list_id=12442aa7-2280-4d5a-86e4-1ee5353f3892&local_midnight=2025-11-10T05%3A00%3A00.000Z
:scheme
https
accept
*/*
accept-encoding
gzip, deflate, br, zstd
accept-language
en-US,en;q=0.9
authorization
Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6IjIiLCJ0eXAiOiJKV1QifQ.eyJkY3QiOjE3NjI3NTkzNzIsImRldmljZV9oYXNoIjoiMTU1YTMxMTRiYTM1ZjI3NzMwODc5ZjRjYjljMDc2MjQiLCJleHAiOjE3NjUzMDA5MzQsImlzcyI6Imh0dHBzOi8vYXBpLnJvYmluaG9vZC5jb20iLCJsZXZlbDJfYWNjZXNzIjp0cnVlLCJtZXRhIjp7Im9pZCI6ImM4MlNIMFdaT3NhYk9YR1Ayc3hxY2ozNEZ4a3ZmbldSWkJLbEJqRlMiLCJvbiI6IlJvYmluaG9vZCJ9LCJvcHRpb25zIjp0cnVlLCJwb3MiOiJwIiwic2NvcGUiOiJpbnRlcm5hbCIsInNlcnZpY2VfcmVjb3JkcyI6W3siaGFsdGVkIjpmYWxzZSwic2VydmljZSI6ImNlcmVzX3VzIiwic2hhcmRfaWQiOjEsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoibnVtbXVzX3VzIiwic2hhcmRfaWQiOjIsInN0YXRlIjoiYXZhaWxhYmxlIn0seyJoYWx0ZWQiOmZhbHNlLCJzZXJ2aWNlIjoiYnJva2ViYWNrX3VzIiwic2hhcmRfaWQiOjEzLCJzdGF0ZSI6ImF2YWlsYWJsZSJ9XSwic2xnIjoxLCJzbHMiOiJrTU5CcGdDaldRTmNiaURiSGtXS2M2NGhleDd5dzdUVWdVN2ZxY1VoRmdXcGNHUTQwVmgxbmU0ZE5CWHVzT3duOEU4d3J2eHBsbFRqU3lFVDU2bk9EZz09Iiwic3JtIjp7ImIiOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjEzfSwiYyI6eyJobCI6ZmFsc2UsInIiOiJ1cyIsInNpZCI6MX0sIm4iOnsiaGwiOmZhbHNlLCJyIjoidXMiLCJzaWQiOjJ9fSwidG9rZW4iOiJ3ZTlzNXpMSE5NclpkUDVRZHJxYWN6TFc0c3NmQmYiLCJ1c2VyX2lkIjoiYzY1ZmQyNTItYjg2NC00ZjBlLWE3NjctYmE0ZjJiZTMyZDcxIiwidXNlcl9vcmlnaW4iOiJVUyJ9.awcwoeCbk8VzAGSmcaF736sufIFjCXRefpKQb5noJIXwKuSIeO-YzALaam2HEAlIf1tMSckAZSsAttV-O0S1-w
origin
https://robinhood.com
priority
u=1, i
referer
https://robinhood.com/
sec-ch-ua
"Chromium";v="141", "Not?A_Brand";v="8"
sec-ch-ua-mobile
?0
sec-ch-ua-platform
"Windows"
sec-fetch-dest
empty
sec-fetch-mode
cors
sec-fetch-site
same-site
user-agent
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36
x-hyper-ex
enabled
x-midlands-api-version
1.66.64
x-timezone-id
America/New_York


====================================================================



