# M-CHAT-R/F content file (licensed text — not in git)

`MCHAT_MODE=inapp` shows the M-CHAT-R/F items and runs the automated Follow-Up in the app. The app does this only when a **content file** is present and valid. That file holds the licensed Vietnamese text keyed by ids. Routing and scoring are fixed in the code (`src/lib/questionnaires/mchatRfStructure.ts`, March 2025 form), and the content file can never change them.

Only `mchat-rf.template.json` is kept in git. It contains ids and empty strings, no wording. Every other `*.json` in this folder is gitignored.

## Before anything: permission

Showing M-CHAT-R/F text in software used by others needs **written permission from the authors** (Diana L. Robins, mchatscreen2009@gmail.com, subject "M-CHAT R/F Permissions Question"). This holds even for a free, non-commercial app.

- Do not create or share a filled file before the permission arrives.
- Never commit a filled file, paste its text into code, tests, issues or chat, or send it to anyone outside the team.
- Record the permission reference (date and message id) in `licenseRef`.

## Steps

1. Regenerate the template so it matches this version of the app:
   `npm run questionnaires:content-template` (writes `content/mchat-rf.template.json`).
2. Copy it to `content/mchat-rf.vi.json`, or to the path set in `MCHAT_CONTENT_PATH`, which is relative to the backend folder.
3. Fill in every empty string **verbatim** from the official licensed Vietnamese file.
   - Recommended source: CCIHP 2015 (`M-CHAT-R_F_VietnameseCCIHP2015.pdf` on mchatscreen.com). Ask the authors to confirm which Vietnamese R/F they endorse.
   - Do not edit, shorten or reorder anything. Do not add images or audio.
4. Fill in the metadata:
   - `contentVersion`: a short id such as `ccihp-2015-vi` (letters, digits, `.`, `_`, `-`). Each response stores it as `<contentVersion>@<structureHash>`.
   - `licenseRef`: the permission reference.
   - `translationSource`: for example `CCIHP 2015, mchatscreen.com`.
   - `copyrightNotice`: the official copyright line as printed on the licensed file. It must contain the authors' line (the validator checks for "Robins"); a translator credit alone is refused. The app always shows the authors' line on every questionnaire screen, and shows this line as well when it says something more (e.g. the translation credit).
   - Leave `instrument`, `structureVersion` and `structureHash` exactly as in the template.
5. Check the file: `npm run questionnaires:validate-content` (or `-- path/to/file.json`). It prints only key paths, never text. Exit code 0 means ready.
6. Set `MCHAT_MODE=inapp` and restart the backend. Admin › Bảng hỏi (`GET /api/admin/questionnaires/status`) shows `ready` with the version and license reference. If the file is missing or invalid, the app falls back to entry by item number, and the admin page lists why.

**Stage 1 only.** The 20 items can be offered before the Follow-Up pages are filled in. The validator then prints `Stage 1 in app: ready`. That needs the metadata, `ui.stage1Instructions` and every `stage1` text (examples per the form); `ui.yes`/`ui.no` fall back to the app's own labels. A MODERATE result then goes to the assisted Follow-Up entry (health worker / a365). The automated Follow-Up starts only once the whole file is `ready`.

## Where each text goes

The ids follow `src/lib/questionnaires/mchatRfStructure.ts`.

- `ui.*`: instructions and labels taken from the official form:
  - the yes/no answer labels;
  - the "maybe" label and the question that resolves a "maybe";
  - the question asked when the parent picks examples from both lists;
  - the placeholder for describing an "Other" row;
  - the stage-1 and Follow-Up instructions.
- `stage1."1"…"20"`: `text` is the item. `examples` is the item's example parenthetical. Leave it `""` for items 2, 11, 13, 14 and 16: the form prints no example there.
- `followUp."N"`: the Follow-Up page of item N.
  - `header`: the item as restated on the page.
  - `recap`: the line recalling the parent's answer.
  - `nodes`: one entry per node:
    - `prompt`: `text` + `note`. `note` is the interviewer note under the open question. Leave it `""` when the licensed page has no note there; never write one yourselves.
    - `cl` / `cnt`: `stem` + `examples.<id>`
    - `q1`, `q2`, `freq`, `f1`, `f2`: `text`
    - `mo`: `text`
    - `q2` of item 7: `text` + `options.optA` / `optBoth` / `optB`
  - Example ids follow the form's order: `p…` = pass-type ("0") examples, `f…` = fail-type ("1") examples, `n…` = examples with no 0/1 label. A trailing `o` is the "Other (describe)" row. These ids stay on the server: the app shows parents position ids (`e1`, `e2`, …) so the group of an example is never visible.
  - Item 2 also has `supplementary.s1` (`text`) and `supplementary.s2` (`text` + `options.r1/r2/r3`).
  - Item 7 has `preambles.after6`, the bridging line shown when item 6 was asked just before.

## How the app reads the form (decisions to confirm with the authors)

- **Item 2: the open question.** Item 2's page has no separate `prompt` node; its graph starts at the checklist `cl`. The open question that recalls the parent's answer is carried by `recap`, which is shown above every item-2 screen. Put that question's text in `followUp."2".recap` (together with the recap line, as printed). If the authors confirm it is a separate open prompt like on the other pages, the structure gets a `prompt` node (a new structure hash).
- **Item 2: the unscored supplementary questions** (`s1`, `s2`). They are asked only when item 2 is part of the Follow-Up, i.e. when item 2 scored 1 at stage 1, right after its score. They never change the score. The form's "for all children" could also mean every child interviewed; the app does not ask them otherwise.
- **"Maybe".** At every yes/no point of the Follow-Up (the yes/no questions and each example row) the parent may answer "maybe"; the app then asks `ui.maybePrompt` and continues with the answer given there. Both are recorded as "maybe → yes/no".
- **"Other (describe)".** A program cannot judge the description, so for each list the app takes the route that does not hide a possible 1, and flags the item for review by a health worker whenever the other choice would have changed the route:
  - not counted (pass-leaning lists): items 3, 9, 15, 17 and 20;
  - counted (fail-leaning lists): item 5 (the row sits in the fail-type list, so the frequency question is asked) and item 12's first list (it counts toward the second list).
  The description itself is stored with the response for the health worker and never shown back or logged.

## Open points to confirm with the authors

- **Item 13.** The 2025 form asks a probe question first (node `q1`). That probe does not exist in the 2015/2018 Vietnamese Follow-Up. Ask the authors for an approved Vietnamese wording. Never translate it yourselves.
- **The readings above** (item 2's open question and supplementary questions, "maybe" on example rows, the "Other" policy).
- **Electronic Follow-Up format.** Ask whether the authors' approved electronic format (Attar et al. 2023) has a Vietnamese version.
- **Terminology.** Ask whether to use the 2025 "likelihood" wording.
