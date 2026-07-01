# Dead-Code & Refactor Audit — CLFN Housing App

_Generated 2026-07 from a 7-way parallel read-only scan of the codebase (~52k lines JS + ~8.5k HTML). Every "dead" claim was grep-verified across all `*.js` and `*.html` (including inline `onclick=` handlers and JS-built HTML strings). This is a living checklist — tick items off as they're cleaned up._

Vanilla-JS static SPA: every `.js` loads as a global script, so a function can be called from any other file or from inline `onclick=` in any `.html`. That's why cross-file grep verification matters.

---

## 🔴 Live bugs surfaced during the audit

These are wired-but-broken today, not merely dead.

- [x] **Inspection → SOW spawn is dead** — `inspections-init.js:~592` called `openSOWModal` (capital W); the real function is `openSowModal`, so the `typeof` guard was always false. It also wrote `_sowCache[unit_id] = {items,…}` (wrong shape — everywhere else `_sowCache[unit_id]` is the SOW record's `data`), which could clobber a unit's real cached SOW. **Fixed** by routing through the `_sowForceNew` + `_sowSeed` path (same as the reno questionnaire) instead of a bespoke cache write.
- [x] **"Reset Defaults" on the scoring-tier editor throws** — `scoring.js:~291` referenced `DEFAULT_V2_TIERS`, which is defined nowhere (`ReferenceError`). **Fixed** by pointing the reset at the real default tier source.
- [x] **`CRITICAL_SOW_CATS` ReferenceError risk on renos.html** — `renos.html:~664` referenced it, but its only definition lived in `scoring.js`, which is not loaded on renos.html. **Fixed** by guarding the reference.
- [x] **Malformed `class` attribute** — `housing-app.js:~2447/2454` used curly/smart quotes (`class="spb-lbl-sub"`), so `.spb-lbl-sub` styling never applied to the Internal-Notes tab preview. **Fixed** with straight quotes.
- [x] **Finance loan-calc-on-open is dead** — `openNewLoanForTenant` is defined in both `finance-nav.js:~192` and `finance-statement.js:~494`; the later-loaded copy (statement.js) wins and omits the `calcLoan()` call. **Fixed** so the winning definition runs the loan calc.

---

## 🟠 Dead code — grep-verified zero-caller, safe to delete (~1,500 lines)

**Batch 2 status (removed 2026-07): ~1,567 lines deleted across 13 files.** Every symbol was re-grep-verified against the whole repo immediately before deletion; each file was re-parsed with `node --check` after. Removed: the notifications.js XLSX block + `_buildRfqEmailHtml`; the shared-data.js worklist/work-queue/movement-log/`deleteContractor`/`renderScoresTable` cluster; the finance-reports quick-payment/reverse subsystem + the finance-misc functions; `loadAppDataFromSupabase` + `exportRenoApprovalsExcel`; the scoring.js V1 editor cluster + `NOS_BED_LABELS` + `SP_APPLICATIONS`; `wireDashTable` / `handleFiles` / `udpOpenFilesModal`.

> ⚠️ **Audit correction:** the scoring.js entry below originally listed `_openScoreByEl`, `_openScoreById`, and `scoreMiniBar` as dead. Re-verification found them **LIVE** — the dashboard score cell (`housing-app.js` `renderDashTable`) emits `data-score-id` + `onclick="window._openScoreByEl(this)"` and calls `scoreMiniBar`. They were **kept**. (The scoring scanner didn't have housing-app.js in scope.)

**Deferred (low-value, left for a later pass to avoid churn/risk):** write-only vars (`_amBestUnitId`, `_saveToggleStates` write side, `_rfqActiveTab`, `_rfqDocLib`, `witness_date`), the duplicate `_ctApprovalIdx`/`_ctPendingAction` redeclarations, the `window.closeTenantCard` alias (harmless documented public API), the `[data-transfer-appid]` dead handler, and the `showEmployeeHome` legacy branch (conditionally reachable on sub-pages — not fully dead).

Items below with `[x]` were removed in Batch 2; `[ ]` remain deferred. Each is grep-verified to have no live caller.

### notifications.js (~720 lines — biggest single win)
- [x] `_xlsxDeadCode_removed` + `_applyXlsxUpdates_dead` + `_applyXlsxNewUnits_dead` + `runXlsxValidation/applyXlsxUpdates/applyXlsxNewUnits` stubs + `_XLSX_2026_REMOVED` (~3193–3768) — entire removed XLSX-import subsystem; the only `onclick=` strings referencing it are emitted inside its own dead HTML builder.
- [x] `_buildRfqEmailHtml` (~2339–2483) — superseded by `_generateRfqPdfBase64`.

### shared-data.js (~200 lines)
- [x] Legacy worklist helpers: `wlSection`, `wlEmpty`, `wlEditApp`, `wlPreviewApp`, `wlAssignApp`, `wlOpenApplicantCell`, `wlOpenIdCell` (keep `wlOpenApp` — still live).
- [x] `getWorkQueueForRole` + `isInWorkQueue`.
- [x] `deleteContractor` — orphaned handler that DELETEs a contractor row from Supabase with no UI path (removal goes through archive). Removing it also closes an unused live DB-delete capability.
- [x] `sbLoadTenantMovementLog` + `sbLoadTenantMovementLogByName`.
- [x] `renderScoresTable` (~65 lines).

### housing-init.js (~200 lines)
- [x] `loadAppDataFromSupabase` (~180 lines — superseded by `loadHousingData`).
- [x] `exportRenoApprovalsExcel` (alias, never invoked).
- [ ] `_amBestUnitId` (write-only), `_saveToggleStates` write side (`_toggleStates` sessionStorage never read).
- [ ] Duplicate `_ctApprovalIdx` / `_ctPendingAction` redeclarations (logic lives in shared-data.js).

### finance-reports.js (~120 lines) + finance misc (~80)
- [x] Quick-payment/reverse subsystem: `saveRentQuickPayment`, `saveArrQuickPayment`, `saveLoanQuickPayment`, `reverseRentEntry`, `reverseArrPayment`, `reverseLoanPmt`, `_doReverseLoanPmt`.
- [x] `finance-statement.js` `openArrPaymentForTenant`, `openLoanPaymentForTenant`.
- [x] `finance-dashboard.js` `dashSearchTenants` (renders into a `#dashSearchResults` element that exists nowhere).
- [x] `finance-init.js` `applyRoleToHeader`, `financeSignOut`.
- [x] `finance-nav.js` `showHome`, `openUtilitiesView`.
- [x] `finance-vouchers.js` `getVoucherSigDataURL`; `finance-data.js` `_toastSuccess`.

### scoring.js (~150 lines)
- [x] V1 scoring-editor cluster: `renderScoringModelTable`, `deleteV2ScoreCriteria`, `updateV2ScoreModel`, `saveScoringModel`, `SCORING_CAT_LABELS` (live editor is `renderV2ScoringEditor`).
- [~] `_openScoreByEl` / `_openScoreById` / `scoreMiniBar` — **NOT dead, KEPT** (audit error; the dashboard score cell in `housing-app.js` uses all three — see the correction note above).
- [x] `NOS_BED_LABELS`, `SP_APPLICATIONS` const (shadowed by `window.SP_APPLICATIONS`, itself always undefined). _(`scoreMiniBar`, previously grouped here, was kept — see above.)_

### housing-app / modals / tic / views / settings / rfq (~150 lines)
- [x] `housing-app.js` `wireDashTable` (retired `#dashView`), `handleFiles`.
- [x] `housing-modals.js` `udpOpenFilesModal`.
- [ ] `housing-tic.js` `window.closeTenantCard` dead alias (internal uses `_ticClose`).
- [ ] `housing-settings.js` `[data-transfer-appid]` delegated handler (rows render `data-tid`; never matches).
- [ ] `housing-views.js` gutted comment scaffolds (968–985, 1805–1829); `showEmployeeHome` legacy tile-grid branch (mostly unreachable on housing.html).
- [ ] `rfq.js` `witness_date` payload field (`rfq_witness_date` element doesn't exist), write-only `_rfqActiveTab`, unused `_rfqDocLib` handle.

---

## 🟡 Refactor / duplication (drift risk)

- [x] **Duplicated scoring/fund models across `scoring.js` ↔ `renos.html`** (HIGH) — **DONE (Batch 3, 2026-07):** `RENO_FUND_RULES`, `DEFAULT_UNIT_SCORE_MODEL`, `DEFAULT_RENO_SCORE_MODEL`, `CRITICAL_SOW_CATS` consolidated into **`shared-config.js`** (the one file loaded on every page; scoring.js/shared-sow.js are not), both copies removed. The two `DEFAULT_RENO_SCORE_MODEL` copies had **drifted** — renos.html used newer "Request Scope"/"maintenance request" labels vs scoring.js's "SOW Scope"; the newer labels were adopted as canonical (display-only; ids/pts/logic were identical, so scoring is unchanged — housing pages now show the newer labels too).
- [ ] **Two near-identical Leaflet location pickers** — `_udpLoc*` (housing-modals.js) vs `_slp*` (housing-tic.js), ~220 lines. One shared picker in shared-ui/shared-data.
- [ ] **PDF scaffolding copy-paste** — nation header/footer + signature-block renderers duplicated across notifications.js (×3 generators), housing-tic.js, housing-modals.js, shared-data.js, finance-pdf/batch/statement/vouchers. Extract shared `_pdfHeader`/`_pdfFooter`/`_pdfSigBlock`.
- [x] **`getAllUnits()` helper** — **DONE (Batch 3, 2026-07):** added `getAllUnits()` to shared-data.js (the universally-loaded layer) and replaced **~49** copies of the units-fallback idiom across commercial-app / housing-init / housing-modals / housing-modals-sow / housing-tic / housing-views / notifications / scoring / shared-data / renos.html (far more than the ~11 estimated). The self-contradictory `.slice()` copies became `getAllUnits().slice()` to preserve copy semantics; the reference-returning ternaries became `getAllUnits()` (behavior-identical). Two no-`.length` variants (reno-questionnaire, shared-data) left as-is — functionally equivalent (empty array either way).
- [ ] **`buildOsmEmbedSrc(lat,lng)`** — OSM embed-iframe URL + bbox math duplicated in housing-tic.js and housing-modals.js (+ a third markup copy in `_ticRenderOverview`).
- [ ] **Boot `<script>` sequence** hand-maintained on 7 sub-pages and already drifting (`rfq.html` omits `approval-authority.js`; renos/contractors load trimmed subsets). Document a canonical block or use a shared loader.
- [ ] **Static AI panel duplication** — `housing.html:~1486` static `#ai_chat_panel` duplicates `_ensureAIPanel` (which no-ops when the static one exists) and hardcodes `"Constance Lake First Nation"` (hard-rule violation). Deleting the static block removes both.
- [x] **`'CLFN'` / nation-short fallback** — **DONE (Batch 3, 2026-07):** added `window.nationShort()` to shared-config.js (CLFN-free `'Housing'` fallback) and routed **18** call sites through it across shared-data / housing-init / housing-tic / inspections-init / notifications — removing every hardcoded `'CLFN'` short-name fallback (Pattern A inline `(NATION_CONFIG.short)||'CLFN'` **and** Pattern B `var short = …||''; (short||'CLFN')` in the notification clause builders). The only `'CLFN'` literals left are the **config default** (`shared-config.js` NATIONS_DIRECTORY, where the CLFN default legitimately lives) and 4 **display-name** fallbacks (`display_name||name)||'CLFN'` in ai-assistant/housing-tic/notifications) — a separate concept best served by a future `nationDisplay()` helper. 🔖 Follow-up: `nationDisplay()` + the `'Constance Lake First Nation'` literals (existing hardcoded-nation backlog).
- [ ] **notifications.js PDF generators** — nested `fld`/`chk`/`fmtCur`/`getSig`/`drawSig` re-declared in all 3 generators; `_addEmail` duplicated verbatim 3×.
- [ ] **finance** — `_financePrintHeader()` helper (print header duplicated 3×); `_buildAgreementPdf(kind,entity)` to merge `previewArrangementAgreement` ↔ `_previewLoanAgreementInner` twins; shared table scaffolding for the `render*Page` trio.
- [ ] **housing-settings ED-guard boilerplate** repeated 6–7× — a shared `edOnly(fn)` / `persistSetting(...)` wrapper (`edGuard()` already exists in shared-ui.js but is under-used).
- [ ] **`_esc` re-implemented** in shared-ui.js, housing-init.js, reno-questionnaire.js, inspections-init.js — reference the shared `escapeHtml`.
- [ ] **`_calcArrearsMonths` vs `_calcCoArrearsMonths`** (housing-app.js) — near-identical, parameterize by field prefix.
- [ ] **Name-collision shadows** worth renaming: `showContractors` (shared-data.js vs contractors-init.js), `sigBlock` (shared-data.js vs nested copies), `openNewLoanForTenant` (fixed as a live bug, but the two definitions should be collapsed).

### Oversized functions to split when next touched
`renderWorklist` (454), `_ticGenerateLeasePdf` (369), `renderTenantProfile` (367), `_ticGenerateHydroOneConsentPdf` (325), `printApplicationPreview` (320), `_buildAddContractorModalHTML` (272), `showEmployeeHome` (262), `_previewLoanAgreementInner` (248), `buildRfqDocumentHtml` (213), `renderRecentActivity` (206), `printTenantStatement` (202), `runBatchAccounting` (199), `generateContractorContract` (178).

---

## Config-hygiene (pre-existing hardcoded-CLFN backlog — clean up in the dedicated pass, per CLAUDE.md)
- `housing.html:~1492` `"Constance Lake First Nation"` literal (static AI panel).
- `housing-modals.js:~1519` `_UDPLOC_CLFN_LAT/LNG = 49.8063 / -84.1434` default map center.
- `'CLFN'` short-name fallbacks in shared-data.js (×7) and elsewhere.
