# Three-page prescreen review

User-approved upload revision: 30 Sep 2026, 12:00 AEST. Team: Uncapped.
Live demo: https://hackathon-site.zemmmeng.workers.dev/
Code: https://github.com/Zemmeng/hackathon

## Current deliverable
- Three English 16:9 pages, 2,032,114 bytes (2.03 MB), below the 10 MB limit.
- Editable source: `../00-prescreen-product-review.html`; PDF: `../00-prescreen-product-review.pdf`.
- Page 1: problem, four AI personas, real-source foundation, value and proposed commercial path; current running La Trobe scene with vehicles and pedestrians.
- Page 2: selected architecture, now explicitly including AI plan comments; implemented features and next delivery. Native SUMO is a separate backend, not the current browser animation. Initial weather backtesting exists; applying findings to frontend parameters is next.
- Page 3: current four-persona tile UI, expanded Visitor explanation and source, real call log / Download JSON; four-junction animation and separate transit/walking panels; saved comparison with genuine LLM comment, human choice and execution pack.
- All three exported PDF pages visually checked. All images load, slide cards have no vertical overflow, six clickable code/demo annotations remain, and extracted slide text contains no Chinese.
- User approved this revision for upload to PR #83. It supersedes the older 1,809,017-byte PDF at 14cc5b9; use the 2,032,114-byte file in this commit.

## Latest system review and screenshot provenance
Reviewed GitHub main at 7b5ed30 and the running production page on 30 Sep. The observed UI includes the four-junction frontend (#95), 2x2 persona tiles (#91), English default (#93) and dark default (#94). Repository evidence additionally includes native SUMO backend (#96) and weather backtest phase 1 (#92). No claim is made that the deployed frontend includes every repository change.

Current assets use suffix `v5`. All product screenshots are actual English dark-mode captures. Only framing, resizing and JPEG compression were applied; no generated vehicles, text or UI. Original full captures remain in `prescreen-build/latest-system` outside this checkout.
- `junction-running-v5.jpg`: La Trobe preset, illustrative scripted micro-simulation, captured at 17:02:43. Nine pedestrians were inside the visible map bounds alongside cars, cyclists, trams and a bus. Scene-state evidence: `hero-running-v5.json`. The hero caption identifies blue cars, purple pedestrians and green trams. This is distinct from Lonsdale quantitative scenarios.
- `four-junctions-v5.jpg`: actual running 2x2 frontend on Little Lonsdale / Lonsdale crossed by Swanston / Russell. Cars and trams are visible; this frontend grid does not simulate pedestrians. `four-junctions-v5.json` records the state. This is the browser micro-simulation, not the new native SUMO backend.
- `ai-tiles-v5.jpg`: all four current baseline persona tiles. `visitor-header-v5.jpg` and `visitor-reason-v5.jpg` show two excerpts from the same expanded Visitor card. The full first-person explanation is preserved; the central caption transcribes its understood/trust readings. `ai-log-v5.jpg` shows the actual source-labelled first recorded event and Download JSON.
- `transit-v5.jpg` and `pedestrians-v5.jpg`: current named-detour / south-footpath-closed panels. Transit crop shows one complete bus row out of 15 affected routes. These are network outputs, not the micro-simulation's queue counter.
- Remote `/api/read` and `/api/explain` endpoints were blocked during all recaptures. No new paid inference in this revision; bundled precomputed readings were used. The call-log count 44 records sign-reading events, not 44 paid model calls.

## Numerical scenarios (keep distinct)
1. Warning-only baseline: Lonsdale WB, weekday 08:00, one lane closed, footpath open. ROADWORK AHEAD / RIGHT LANE CLOSED: 918 m queue, 10,493 veh-min/h, 18,693 rider-min/h, 14% detouring. Current persona readings: Commuter understood 98%, trusts 92%; Local 95% / 88%; Visitor 68% / 75%; Delivery 94% / 88%. Source LLM PRECOMPUTED; trust is assumed. Raw evidence: `persona-baseline-v5.json`.
2. Add USE RUSSELL ST: 538 m queue, 5,629 veh-min/h, 10,991 rider-min/h, 35% detouring. Vehicle delay reduction is 46.35%. These values were rechecked on the current live system using precomputed data.
3. Same named-detour site with south/works-side footpath also closed: +176 m, two crossings, approximately 185 pedestrians/h (interpolated). Evidence: `named-footpath-v5.json`. Footpath-open and footpath-closed variants are explicitly separated in the deck.
4. Clash: shift the other demo-register works by three days to end the overlap. No exact monetary or vehicle-minute clash saving is claimed; past captures differed by reading source.
5. Separate saved three-kit comparison, same Lonsdale hour, footpath open: Minimum / Standard / Guided hire A$515 / A$1,765 / A$1,765 for five assumed days; vehicle delay 10,493 / 10,493 / 937 veh-min/h. Guided uses different VMS wording, including the named detour. The 937 result is labelled saved, not newly verified live. Warning-only equipment's safety value is not scored by this delay model.

## AI comments and limits of claims
The separate plan-level comment is a real previously authorized LLM response: one POST `/api/explain`, HTTP 200, src=llm, model=deepseek-flash, prompt_v=e2. Exact request/response: `ai-comment-saved-run.json`. Page 3 quotes its Guided summary and paraphrases the two Cons as a trade-off. No additional comment request was made for this update. It is an explanation of saved engine outputs, not a new traffic run.

Real-source foundation: OSM roads, SCATS counts, PTV GTFS and City of Melbourne pedestrian counters. Some flows are estimated. Passenger loads, driver mix/behaviour, stock and hire rates include assumptions. Current moving agents are illustrative. These screenshots establish a running implementation, not field deployment or measured improvements. The commercial model and one-worksite pilot remain proposals.

## Visual provenance
Product captures are actual screenshots, not generated interfaces. The selected architecture remains SVG. All visible slide copy remains text in the HTML/PDF.
The decorative city background is conceptual artwork generated with the built-in GPT Image tool. It is not a map or evidence of product coverage.
Asset: `city-background.jpg`

Final generation prompt:
Use case: productivity-visual. Asset type: subtle 16:9 background plate for a three-page professional product presentation about a Melbourne roadworks simulation tool, RippleTwin. Create only the decorative background, not a slide, diagram or product interface. Warm ivory #FAF8F3, premium matte paper atmosphere. Very subtle embossed aerial rectilinear city blocks and street geometry, inspired by a gridded central business district, concentrated at far upper-right and far lower-left edges. Sparse muted teal #087C76 route-like accents and soft navy-grey architectural shadows. Almost all contrast must stay at the outermost edges. Keep the central 85 percent and the upper-left title region empty and nearly uniform ivory so real product screenshots, exact editable text and a real architecture diagram can be placed over it. Extremely restrained, spacious, crisp editorial design. No words, no letters, no labels, no numbers, no logos, no arrows, no UI, no simulated data, no people, no gradients into dark backgrounds. This is conceptual decoration, not an accurate map. Landscape 16:9.

## Link prominence and wording clarification
The first page now has large teal Demo and navy GitHub links, full underlined URLs and an explicit CLICK TO OPEN cue. Both complete rectangles are linked in the PDF. Page 3 explains that Guided adds USE RUSSELL / SAVE 9 MIN, unlike the wording-only -46% case. The vague Different VMS wording footnote is removed; the sign phrase stays on one line, page 03 is restored, and repeated persona wording is shortened. No traffic figures were changed and no model calls were made.

The two prominent links have been moved into the top header at the user’s request. The hero is restored to its previous 610 px display height, instead of the shortened 516 px frame. Existing close-up framing is preserved. Final first-page PDF rendering and all six link annotations were checked.
