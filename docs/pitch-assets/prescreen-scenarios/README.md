# Three-page prescreen review

Status: review draft, 30 Sep 2026. Team: Uncapped (confirmed by user).
Live demo: https://hackathon-site.zemmmeng.workers.dev/ — verified 30 Sep 2026 AEST: HTTP 200, English interface, road map and engine results loaded, no page JavaScript errors during the check. Clickable links included on pages 1 and 3. This is a point-in-time availability check.

## Contents
1. Prominent Uncapped team identity. Working roadworks system built on real Melbourne data: prominent OSM / SCATS / PTV / pedestrian source line, problem / innovation / decision copy, and an English dark-mode running junction screenshot with vehicles, tram, hoarding and signs.
2. Selected architecture (the version before the large arrow band), technical stack and Day 3 delivery.
3. Four consistent product cards: site configuration, AI driver responses, network impact and comparison/export. Three modelled outcome highlights sit in a separate bottom strip.

Editable layout: ../00-prescreen-product-review.html. Review PDF: [00-prescreen-product-review.pdf](../00-prescreen-product-review.pdf). The PDF is optimized below the repository’s 1 MiB limit; editable text, vector architecture and both live-demo links are retained. Original 00-prescreen.pdf is unchanged.

## Product evidence
Latest product-interface and AI captures are from local product commit 2ab2a92fb49f14870b6f3088447871ec4e5f2df8, after the AI road-user panel merged. The earlier execution-pack table is from commit 4c7d30ad05080ee5714ee4d6779a518daa96826c; the scenario outputs remain consistent. The implemented engine uses open-data inputs and bundled LLM readings. No paid inference was requested; explanations use rule fallback locally. Screenshots show a working implementation, not evidence of field deployment.
- The junction screenshot is captured while the simulation runs (17:00:12). The moving vehicles are an illustrative scripted micro-simulation on a real map, distinct from the LLM persona sign-reading model.
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
