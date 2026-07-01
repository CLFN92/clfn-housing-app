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

Not yet removed (this pass fixed only the live bugs). Each is grep-verified to have no live caller.

### notifications.js (~720 lines — biggest single win)
- [ ] `_xlsxDeadCode_removed` + `_applyXlsxUpdates_dead` + `_applyXlsxNewUnits_dead` + `runXlsxValidation/applyXlsxUpdates/applyXlsxNewUnits` stubs + `_XLSX_2026_REMOVED` (~3193–3768) — entire removed XLSX-import subsystem; the only `onclick=` strings referencing it are emitted inside its own dead HTML builder.
- [ ] `_buildRfqEmailHtml` (~2339–2483) — superseded by `_generateRfqPdfBase64`.

### shared-data.js (~200 lines)
- [ ] Legacy worklist helpers: `wlSection`, `wlEmpty`, `wlEditApp`, `wlPreviewApp`, `wlAssignApp`, `wlOpenApplicantCell`, `wlOpenIdCell` (keep `wlOpenApp` — still live).
- [ ] `getWorkQueueForRole` + `isInWorkQueue`.
- [ ] `deleteContractor` — orphaned handler that DELETEs a contractor row from Supabase with no UI path (removal goes through archive). Removing it also closes an unused live DB-delete capability.
- [ ] `sbLoadTenantMovementLog` + `sbLoadTenantMovementLogByName`.
- [ ] `renderScoresTable` (~65 lines).

### housing-init.js (~200 lines)
- [ ] `loadAppDataFromSupabase` (~180 lines — superseded by `loadHousingData`).
- [ ] `exportRenoApprovalsExcel` (alias, never invoked).
- [ ] `_amBestUnitId` (write-only), `_saveToggleStates` write side (`_toggleStates` sessionStorage never read).
- [ ] Duplicate `_ctApprovalIdx` / `_ctPendingAction` redeclarations (logic lives in shared-data.js).

### finance-reports.js (~120 lines) + finance misc (~80)
- [ ] Quick-payment/reverse subsystem: `saveRentQuickPayment`, `saveArrQuickPayment`, `saveLoanQuickPayment`, `reverseRentEntry`, `reverseArrPayment`, `reverseLoanPmt`, `_doReverseLoanPmt`.
- [ ] `finance-statement.js` `openArrPaymentForTenant`, `openLoanPaymentForTenant`.
- [ ] `finance-dashboard.js` `dashSearchTenants` (renders into a `#dashSearchResults` element that exists nowhere).
- [ ] `finance-init.js` `applyRoleToHeader`, `financeSignOut`.
- [ ] `finance-nav.js` `showHome`, `openUtilitiesView`.
- [ ] `finance-vouchers.js` `getVoucherSigDataURL`; `finance-data.js` `_toastSuccess`.

### scoring.js (~150 lines)
- [ ] V1 scoring-editor cluster: `renderScoringModelTable`, `deleteV2ScoreCriteria`, `updateV2ScoreModel`, `saveScoringModel`, `SCORING_CAT_LABELS` (live editor is `renderV2ScoringEditor`).
- [ ] `_openScoreByEl` / `_openScoreById` (no `data-score-id` element emitted anywhere).
- [ ] `scoreMiniBar`, `NOS_BED_LABELS`, `SP_APPLICATIONS` const (shadowed by `window.SP_APPLICATIONS`, itself always undefined).

### housing-app / modals / tic / views / settings / rfq (~150 lines)
- [ ] `housing-app.js` `wireDashTable` (retired `#dashView`), `handleFiles`.
- [ ] `housing-modals.js` `udpOpenFilesModal`.
- [ ] `housing-tic.js` `window.closeTenantCard` dead alias (internal uses `_ticClose`).
- [ ] `housing-settings.js` `[data-transfer-appid]` delegated handler (rows render `data-tid`; never matches).
- [ ] `housing-views.js` gutted comment scaffolds (968–985, 1805–1829); `showEmployeeHome` legacy tile-grid branch (mostly unreachable on housing.html).
- [ ] `rfq.js` `witness_date` payload field (`rfq_witness_date` element doesn't exist), write-only `_rfqActiveTab`, unused `_rfqDocLib` handle.

---

## 🟡 Refactor / duplication (drift risk)

- [ ] **Duplicated scoring/fund models across `scoring.js` ↔ `renos.html`** (HIGH): `RENO_FUND_RULES`, `DEFAULT_UNIT_SCORE_MODEL`, `DEFAULT_RENO_SCORE_MODEL`, `CRITICAL_SOW_CATS`. Hoist each to one shared source; editing one copy silently diverges the other.
- [ ] **Two near-identical Leaflet location pickers** — `_udpLoc*` (housing-modals.js) vs `_slp*` (housing-tic.js), ~220 lines. One shared picker in shared-ui/shared-data.
- [ ] **PDF scaffolding copy-paste** — nation header/footer + signature-block renderers duplicated across notifications.js (×3 generators), housing-tic.js, housing-modals.js, shared-data.js, finance-pdf/batch/statement/vouchers. Extract shared `_pdfHeader`/`_pdfFooter`/`_pdfSigBlock`.
- [ ] **`getAllUnits()` helper** — a self-contradictory units-fallback idiom copy-pasted ~11× across housing-init/app/modals/views/shared-data.
- [ ] **`buildOsmEmbedSrc(lat,lng)`** — OSM embed-iframe URL + bbox math duplicated in housing-tic.js and housing-modals.js (+ a third markup copy in `_ticRenderOverview`).
- [ ] **Boot `<script>` sequence** hand-maintained on 7 sub-pages and already drifting (`rfq.html` omits `approval-authority.js`; renos/contractors load trimmed subsets). Document a canonical block or use a shared loader.
- [ ] **Static AI panel duplication** — `housing.html:~1486` static `#ai_chat_panel` duplicates `_ensureAIPanel` (which no-ops when the static one exists) and hardcodes `"Constance Lake First Nation"` (hard-rule violation). Deleting the static block removes both.
- [ ] **`'CLFN'` / nation-short fallback ×7** in shared-data.js (+ scattered elsewhere) — collapse into a single `nationShort()` helper so the literal lives in one place (hard-rule backlog).
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
