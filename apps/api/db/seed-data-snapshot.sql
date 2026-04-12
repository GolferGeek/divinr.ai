--
-- PostgreSQL database dump
--

\restrict Qu9AM8zNS5FzE0K1bSVkUhWZwT3XMyHwKUUAA2JywIUHSXlwB9eclC7BDwtFaxj

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: rbac_permissions; Type: TABLE DATA; Schema: authz; Owner: -
--

COPY authz.rbac_permissions (id, name, display_name, description, category) FROM stdin;
7daf0110-1a59-43ef-8355-47a62af845e4	compliance.documents.read	Read Compliance Documents	\N	compliance
476d0e66-7202-4f5a-b011-8b5ead32dff3	compliance.documents.write	Write Compliance Documents	\N	compliance
markets-instruments-read	markets.instruments.read	Read Market Instruments	\N	markets
markets-instruments-write	markets.instruments.write	Write Market Instruments	\N	markets
\.


--
-- Data for Name: rbac_roles; Type: TABLE DATA; Schema: authz; Owner: -
--

COPY authz.rbac_roles (id, name, display_name, description, is_system) FROM stdin;
cb80ba24-f8c2-422a-94fd-18e046236591	run_1775836200185:admin	Compliance Admin	\N	f
9664e4bb-d17f-4dd6-a85f-d19e3861a305	run_1775836200185:analyst	Compliance Analyst	\N	f
role-super-admin	super-admin	Super Admin	Full access across all organizations	t
role-owner	owner	Owner	Owns and manages an organization	t
role-member	member	Member	Standard member of an organization	t
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: authz; Owner: -
--

COPY authz.users (id, email, display_name, status, created_at, updated_at) FROM stdin;
seed-user-alpha	admin@alpha-capital.demo	Alpha Capital Admin	active	2026-04-07 20:40:01.61173+00	2026-04-07 20:40:01.61173+00
seed-user-steadfast	admin@steadfast-advisors.demo	Steadfast Advisors Admin	active	2026-04-07 20:40:01.61173+00	2026-04-07 20:40:01.61173+00
seed-user-apex	admin@apex-quant.demo	Apex Quant Admin	active	2026-04-07 20:40:01.61173+00	2026-04-07 20:40:01.61173+00
13069c48-e606-4915-8c21-9c7c82e46977	demo-user@orchestratorai.io	demo-user	active	2026-04-08 22:09:05.78526+00	2026-04-08 22:09:05.78526+00
1a5a53fe-a8ed-4f66-9e47-fdc37f0fc926	golfergeek@orchestratorai.io	golfergeek	active	2026-04-08 22:09:05.78526+00	2026-04-08 22:09:05.78526+00
\.


--
-- Data for Name: rbac_user_roles; Type: TABLE DATA; Schema: authz; Owner: -
--

COPY authz.rbac_user_roles (user_id, organization_slug, role_id, assigned_by, assigned_at, expires_at) FROM stdin;
1a5a53fe-a8ed-4f66-9e47-fdc37f0fc926	personal-golfergeek	role-owner	bootstrap	2026-04-08 22:09:05.789343+00	\N
13069c48-e606-4915-8c21-9c7c82e46977	personal-demo-user	role-owner	bootstrap	2026-04-08 22:09:05.791652+00	\N
1a5a53fe-a8ed-4f66-9e47-fdc37f0fc926	__base__	role-super-admin	see-your-reasoning-effort	2026-04-09 00:56:16.07768+00	\N
13069c48-e606-4915-8c21-9c7c82e46977	__base__	role-member	see-your-reasoning-effort	2026-04-09 01:03:12.209953+00	\N
\.


--
-- Data for Name: domains; Type: TABLE DATA; Schema: prediction; Owner: -
--

COPY prediction.domains (slug, display_name, description, prediction_plane, is_active, created_at) FROM stdin;
financial	Financial Markets	Stocks, crypto, commodities	stocks	t	2026-04-03 18:09:56.402736+00
betting	Betting Markets	Sports, prediction markets, props	sports	f	2026-04-03 18:09:56.402736+00
elections	Election Coverage	US and international elections	elections	f	2026-04-03 18:09:56.402736+00
\.


--
-- Data for Name: source_catalog; Type: TABLE DATA; Schema: prediction; Owner: -
--

COPY prediction.source_catalog (id, source_key, display_name, base_url, tier, is_global_default, created_at, source_origin, external_source_id, domain_slug, universe_slug, source_type, crawl_frequency_minutes, last_crawled_at, last_crawl_error) FROM stdin;
source_marketwatch	marketwatch	MarketWatch	https://www.marketwatch.com	standard	t	2026-03-30 20:52:34.734917+00	divinr	\N	financial	\N	rss	60	2026-04-06 19:34:37.869204+00	\N
source_reuters	reuters	Reuters	https://www.reuters.com	premium	t	2026-03-30 20:52:34.734917+00	divinr	\N	financial	\N	rss	60	2026-04-06 19:34:39.005393+00	\N
source_yahoo_finance	yahoo_finance	Yahoo Finance	https://finance.yahoo.com/news/rssindex	free	t	2026-04-03 21:27:11.911762+00	divinr	\N	financial	stocks	rss	60	2026-04-12 18:00:12.577137+00	\N
source_cnbc	cnbc	CNBC	https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114	free	t	2026-04-03 21:27:11.911762+00	divinr	\N	financial	stocks	rss	60	2026-04-12 18:00:12.88161+00	\N
source_bloomberg_markets	bloomberg_markets	Bloomberg Markets	https://news.google.com/rss/search?q=site:bloomberg.com+stock+market&hl=en-US&gl=US&ceid=US:en	free	t	2026-04-03 21:27:11.911762+00	divinr	\N	financial	stocks	rss	60	2026-04-12 18:00:13.819123+00	\N
source_wsj_markets	wsj_markets	WSJ Markets	https://news.google.com/rss/search?q=site:wsj.com+stock+market&hl=en-US&gl=US&ceid=US:en	free	t	2026-04-03 21:27:11.911762+00	divinr	\N	financial	stocks	rss	60	2026-04-12 18:00:14.391295+00	\N
source_seeking_alpha	seeking_alpha	Seeking Alpha	https://seekingalpha.com/feed.xml	free	t	2026-04-03 21:27:11.911762+00	divinr	\N	financial	stocks	rss	60	2026-04-12 18:00:14.570099+00	\N
source_benzinga	benzinga	Benzinga	https://news.google.com/rss/search?q=site:benzinga.com+stocks&hl=en-US&gl=US&ceid=US:en	free	t	2026-04-03 21:27:11.911762+00	divinr	\N	financial	stocks	rss	60	2026-04-12 18:00:15.268701+00	\N
source_motley_fool	motley_fool	Motley Fool	https://news.google.com/rss/search?q=site:fool.com+stocks&hl=en-US&gl=US&ceid=US:en	free	t	2026-04-03 21:27:11.911762+00	divinr	\N	financial	stocks	rss	60	2026-04-12 18:00:15.895804+00	\N
source_barrons	barrons	Barrons	https://news.google.com/rss/search?q=site:barrons.com+markets&hl=en-US&gl=US&ceid=US:en	free	t	2026-04-03 21:27:11.911762+00	divinr	\N	financial	stocks	rss	60	2026-04-12 18:00:16.453637+00	\N
source_investopedia	investopedia	Investopedia	https://news.google.com/rss/search?q=site:investopedia.com+stocks&hl=en-US&gl=US&ceid=US:en	free	t	2026-04-03 21:27:11.911762+00	divinr	\N	financial	stocks	rss	60	2026-04-12 18:00:17.783008+00	\N
orchestrator_source_11111111-1111-4111-8111-111111111111	orchestrator_demo_feed_11111111	Orchestrator Demo Feed	https://demo-feed.example/rss	standard	t	2026-04-07 20:52:17.858502+00	orchestrator_crawler	11111111-1111-4111-8111-111111111111	financial	\N	rss	60	\N	\N
source_financial_times	financial_times	Financial Times	https://news.google.com/rss/search?q=site:ft.com+stock+market&hl=en-US&gl=US&ceid=US:en	free	t	2026-04-03 21:27:11.911762+00	divinr	\N	financial	stocks	rss	60	2026-04-12 18:00:17.156646+00	\N
\.


--
-- Data for Name: universes; Type: TABLE DATA; Schema: prediction; Owner: -
--

COPY prediction.universes (slug, domain_slug, display_name, description, default_evaluation_horizons, horizon_unit, is_active, metadata, created_at) FROM stdin;
stocks	financial	Stocks	Equities and stock market instruments	[1, 3, 5]	days	t	{}	2026-04-03 18:09:56.402736+00
crypto	financial	Crypto	Cryptocurrency instruments	[1, 3, 5]	days	f	{}	2026-04-03 18:09:56.402736+00
commodities	financial	Commodities	Gold, oil, natural gas	[1, 3, 5]	days	f	{}	2026-04-03 18:09:56.402736+00
polymarket	betting	Prediction Markets	Polymarket, Kalshi contracts	[1, 3, 5]	days	f	{}	2026-04-03 18:09:56.402736+00
nfl	betting	NFL	NFL games and props	[1]	days	f	{}	2026-04-03 18:09:56.402736+00
mlb	betting	MLB	MLB games and props	[1]	days	f	{}	2026-04-03 18:09:56.402736+00
us-2028-pres	elections	US 2028 Presidential	State and national races	[7, 3, 1]	days	f	{}	2026-04-03 18:09:56.402736+00
us-2026-mid	elections	US 2026 Midterms	Senate, House, Governor races	[7, 3, 1]	days	f	{}	2026-04-03 18:09:56.402736+00
eu-elections	elections	European Elections	UK, France, Germany, EU Parliament	[7, 3, 1]	days	f	{}	2026-04-03 18:09:56.402736+00
\.


--
-- PostgreSQL database dump complete
--

\unrestrict Qu9AM8zNS5FzE0K1bSVkUhWZwT3XMyHwKUUAA2JywIUHSXlwB9eclC7BDwtFaxj

