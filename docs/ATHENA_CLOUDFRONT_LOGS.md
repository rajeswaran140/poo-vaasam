# Athena over CloudFront access logs

Query the media CDN's access logs (reach + cache-hit ratio) with SQL.

- **Distribution:** `EV5MK0A02KLHV` (`d2cdoh43143xxa.cloudfront.net`) — the media CDN in front of the private `tamil-web-media` bucket.
- **Logs:** standard logging **v2** → `s3://tamilagaval-cloudfront-logs/AWSLogs/975050319109/CloudFront/` (gzip, W3C 33-field format, 2 header lines/file).
- **Athena DB/table:** `tamilagaval_logs.cloudfront_access` (region **us-east-1**).
- **Query results location:** `s3://tamilagaval-cloudfront-logs/athena-results/`

Run in the Athena console (us-east-1) or via CLI (`aws athena start-query-execution --result-configuration OutputLocation=s3://tamilagaval-cloudfront-logs/athena-results/`).

> Note on geo: CloudFront **standard** logs have no country field — only the edge **POP** (`x_edge_location`, e.g. `YTO`=Toronto, `MAA`=Chennai, `BOM`=Mumbai). Use the 3-letter prefix as a geo *proxy*. For true per-country, switch to CloudFront real-time logs (Kinesis) which expose `c-country`.

## Table DDL (recreate if needed)

```sql
CREATE EXTERNAL TABLE IF NOT EXISTS tamilagaval_logs.cloudfront_access (
  `date` DATE, time STRING, x_edge_location STRING, sc_bytes BIGINT, c_ip STRING,
  cs_method STRING, cs_host STRING, cs_uri_stem STRING, sc_status INT, cs_referer STRING,
  cs_user_agent STRING, cs_uri_query STRING, cs_cookie STRING, x_edge_result_type STRING,
  x_edge_request_id STRING, x_host_header STRING, cs_protocol STRING, cs_bytes BIGINT,
  time_taken FLOAT, x_forwarded_for STRING, ssl_protocol STRING, ssl_cipher STRING,
  x_edge_response_result_type STRING, cs_protocol_version STRING, fle_status STRING,
  fle_encrypted_fields INT, c_port INT, time_to_first_byte FLOAT,
  x_edge_detailed_result_type STRING, sc_content_type STRING, sc_content_len BIGINT,
  sc_range_start BIGINT, sc_range_end BIGINT
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY '\t'
LOCATION 's3://tamilagaval-cloudfront-logs/AWSLogs/975050319109/CloudFront/'
TBLPROPERTIES ('skip.header.line.count'='2');
```

## Starter queries

```sql
-- Cache-hit ratio (Hit + RefreshHit vs all)
SELECT round(100.0*sum(CASE WHEN x_edge_result_type IN ('Hit','RefreshHit') THEN 1 ELSE 0 END)/count(*),1) AS cache_hit_pct,
       count(*) total
FROM tamilagaval_logs.cloudfront_access;

-- Result-type breakdown
SELECT x_edge_result_type, count(*) n
FROM tamilagaval_logs.cloudfront_access GROUP BY 1 ORDER BY n DESC;

-- Reach proxy: requests by edge POP
SELECT substr(x_edge_location,1,3) pop, count(*) n
FROM tamilagaval_logs.cloudfront_access GROUP BY 1 ORDER BY n DESC;

-- Most-played songs (audio object hits)
SELECT cs_uri_stem, count(*) n
FROM tamilagaval_logs.cloudfront_access
WHERE cs_uri_stem LIKE '/audio/%' AND cs_method='GET'
GROUP BY 1 ORDER BY n DESC LIMIT 20;

-- Bytes served per day (egress proxy)
SELECT "date", round(sum(sc_bytes)/1e6,1) mb FROM tamilagaval_logs.cloudfront_access GROUP BY 1 ORDER BY 1;
```

Decode Tamil object names in results by URL-decoding `cs_uri_stem` (percent-encoded UTF-8).
