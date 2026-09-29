# Three-page prescreen review

Status: review draft, 30 Sep 2026. Team: Uncapped (confirmed by user).
Live demo: https://hackathon-site.zemmmeng.workers.dev/ — verified 30 Sep 2026 AEST: HTTP 200, English interface, road map and engine results loaded, no page JavaScript errors during the check. Clickable links included on pages 1 and 3. This is a point-in-time availability check.

## Contents
1. Prominent Uncapped team identity. Working roadworks system built on real Melbourne data: prominent OSM / SCATS / PTV / pedestrian source line, problem / innovation / decision copy, and a large English dark-mode running junction view with cars, pedestrians, cyclists and trams.
2. Selected architecture (the version before the large arrow band), technical stack and Day 3 delivery.
3. Four consistent product cards: running junction with cars and pedestrians, AI driver responses, network/transit/walking impact and comparison/export. Three modelled outcome highlights sit in a separate bottom strip.

Editable layout: ../00-prescreen-product-review.html. Review PDF: [00-prescreen-product-review.pdf](../00-prescreen-product-review.pdf). The uploaded PDF is the reviewed high-quality export (1,809,017 bytes, about 1.81 MB), below the repository’s updated 10 MB pitch-PDF limit. Editable text, vector architecture, and clickable code/demo links are retained. Original 00-prescreen.pdf is unchanged.

## Product evidence
Earlier product-interface and AI captures were from local product commit 2ab2a92fb49f14870b6f3088447871ec4e5f2df8, after the AI road-user panel merged. The earlier execution-pack table is from commit 4c7d30ad05080ee5714ee4d6779a518daa96826c; the scenario outputs remain consistent. The implemented engine uses open-data inputs and bundled LLM readings. No paid inference was requested; explanations use rule fallback locally. Screenshots show a working implementation, not evidence of field deployment.
- The current junction screenshot is captured while the simulation runs (17:02:43). The moving vehicles are an illustrative scripted micro-simulation on a real map, distinct from the LLM persona sign-reading model.
- Four AI personas: commuter, local, visitor and delivery. Actual panel cards show precomputed readings: commuter understood 92%, visitor understood 57% for the same sign. These are model readings, not measured human behaviour.
- Real-source foundation: OSM roads, SCATS counts, PTV GTFS timetables and City of Melbourne pedestrian counts. Some flows are estimated; behaviour, passenger loads, equipment stock and hire costs include assumptions.
- VMS case: Lonsdale St westbound, weekday 08:00, one lane closed. ROADWORK AHEAD: 918 m queue, 10,493 vehicle-minutes. Add USE RUSSELL ST: 538 m, 5,629 vehicle-minutes (46.36% less). Bus passenger delay: 18,693 to 10,991 passenger-minutes.
- Clash: same named-detour plan with demo register closure on Little Bourke Street. Three overlapping days, 08:00 and 17:00 each day (six sampled hours). D(A)=31,518, D(B)=24, D(A+B)=58,722, cost rounded 27,180 vehicle-minutes. Moving the other works by three days gives zero sampled overlap cost. These differ from the old rule-reader run.
- Footpath: works-side closure, estimated 185 pedestrians/hour, 176 additional metres, two crossings. Step-free access unknown. The transit crop shows two of the 15 affected bus routes.
- Equipment: Minimum, Standard and Guided options. Five-day assumed hire totals A$515 / A$1,765 / A$1,765. Vehicle delays 10,493 / 10,493 / 937 vehicle-minutes. The screenshot is a real exported execution-pack preview. Equipment stock and rates are assumptions.

## Visual provenance
Product captures are actual screenshots, not generated interfaces. The selected architecture remains SVG. All visible slide copy remains text in the HTML/PDF.
The decorative city background is conceptual artwork generated with the built-in GPT Image tool. It is not a map or evidence of product coverage.
Asset: `city-background.jpg`

Final generation prompt:
Use case: productivity-visual. Asset type: subtle 16:9 background plate for a three-page professional product presentation about a Melbourne roadworks simulation tool, RippleTwin. Create only the decorative background, not a slide, diagram or product interface. Warm ivory #FAF8F3, premium matte paper atmosphere. Very subtle embossed aerial rectilinear city blocks and street geometry, inspired by a gridded central business district, concentrated at far upper-right and far lower-left edges. Sparse muted teal #087C76 route-like accents and soft navy-grey architectural shadows. Almost all contrast must stay at the outermost edges. Keep the central 85 percent and the upper-left title region empty and nearly uniform ivory so real product screenshots, exact editable text and a real architecture diagram can be placed over it. Extremely restrained, spacious, crisp editorial design. No words, no letters, no labels, no numbers, no logos, no arrows, no UI, no simulated data, no people, no gradients into dark backgrounds. This is conceptual decoration, not an accurate map. Landscape 16:9.

## Review feedback revision (30 Sep, local draft)
- Page 1 uses the running La Trobe junction frame at 17:02:43, cropped to enlarge cars, pedestrians and the works zone. The user explicitly requested these in the first-page hero, replacing the static Lonsdale network view. The crop omits the La Trobe low-delay panel; quantitative results remain on page 3 with their own scenario footnotes. Live-demo and GitHub links remain.
- Page 3 retains four product capabilities: running junction, AI readings, network/transit/walking impact, and comparison/export. AI occupies one card.
- Headline comparison now matches the saved three-kit table: Standard 10,493 → Guided 937 vehicle-minutes (91.07% reduction), footpath open. The former 46.36% case is a different wording-only scenario and is no longer the headline.
- Footpath result has its own footnote: Lonsdale westbound, USE RUSSELL ST sign, one lane and south (works-side) footpath closed. AI card readings use a separate USE RUSSELL ST example, explicitly labelled.
- Removed exact clash cost from the presentation pending live-source verification. The 3-day schedule shift removes calendar overlap independent of reading-source differences.
- The diagnostic run with external AI requests blocked produced clash cost 33,012, not the supplied review's 33,015. Its recorded source includes rule fallback, so it is not used as a verified exact live value. Evidence retained locally in prescreen-build/revision-3/evidence.json. A true live rerun was blocked by automatic approval review. The user then chose existing precomputed data only; no bulk sign-reading rerun was authorized or performed. The later single, explicitly authorized AI-comment request is documented below. The deck explicitly distinguishes saved scenario inputs instead of claiming a new live LLM verification.
- Concrete Day 3 deliverables: verified multimodal/clash scenarios; three-plan execution pack with source/assumption notes; rehearsed live demo and backup recording.
- Product navigation standardized to Plan / Junction Sim / Impact / Improve. Architecture labels describe internal computation stages and are no longer numbered like UI steps. Visitor terminology is consistent.
- Starters, repository visibility and repository-wide history scans are outside this pitch task.

Dynamic frame: the existing local micro-simulation ran to 17:02:43 without changing its agents or model. The captured scene contains cars, cyclists, trams, a bus and 9 pedestrians inside the visible map bounds (148 road users in the full scene). All remote read/explain requests were blocked as requested; no paid inference. Counts are illustrative scene state, not observed traffic.

## Fixlist and authorized AI-comment revision (30 Sep)
- Keeps the first-page running vehicle/pedestrian view requested by the user. The caption now distinguishes La Trobe 17:00 (0 m queue) from the Lonsdale 08:00 named-detour scenario (538 m queue).
- Restores the -46% headline for the saved wording-only comparison (10,493 to 5,629 vehicle-min/h). The three-kit table is labelled as a separate saved run; 937 is not promoted as a live reproducible headline.
- South-footpath closure is explicit for +176 m; ~185 pedestrians/h is interpolated. Footnotes are 16 CSS px = 12 PDF pt.
- Warning-only equipment safety value is not scored by the delay model. Proposed quote/report business model and a one-worksite pilot are clearly proposals.
- Adds printed code/demo URLs and clickable links, concrete Day 3 deliverables, driver persona / visitor terminology and vehicle-min units for clash D. Exact clash cost is not reinstated without matching-source verification.
- Following the user's explicit authorization, made exactly ONE POST /api/explain request against the saved three-plan engine outputs. Returned HTTP 200, src=llm, model=deepseek-flash, prompt_v=e2. No new sign-reading inference was requested. Estimate under CNY 0.05 from the project's recorded rate; actual token usage/billing was not returned.
- ai-comment-saved-run.json contains the exact request and response. Page 3 quotes the Guided summary verbatim and paraphrases its two Cons as a trade-off, alongside an editable compact table and human-choice/export flow. The model's truncated lean sentence is not used. This is a recorded LLM comment on saved results, not a new traffic run.
- Real comment UI capture retained locally in prescreen-build/revision-3/ai-comment-guided-full.png. It was rendered by the existing product view from the same API response, without another model call.
- User requested English throughout; slide copy, screenshots and model comment are English.
