/* ============================================================================
 * DEMO SEED SCRIPT  —  run in the browser console on demo.fnhub.app
 * while signed in as the ED (Executive Director).
 *
 * Creates realistic sample data for the Demo nation:
 *   - 5 contractors
 *   - 58 units (50 occupied -> 50 tenants via the sync trigger + 8 vacant)
 *   - 10 applications (mix of types/statuses; approved ones show on Match)
 *   - 5 maintenance requests (SOWs)
 *   - 2 RFQs (linked to 2 of the SOWs)
 *   - 2 capital projects
 *
 * HOW TO RUN
 *   1. Open https://demo.fnhub.app and sign in as the ED.
 *   2. Open the browser console (F12 -> Console).
 *   3. Paste this whole file and press Enter.
 *   4. Watch the log; refresh the app when it prints "SEED COMPLETE".
 *
 * It is idempotent-ish: re-running creates fresh records (new ids), so run once.
 * To remove seed data later, filter by the "SEED" markers noted below.
 * ========================================================================== */
(async function seedDemo(){
  if (typeof SUPABASE_URL === 'undefined' || typeof HOUSING_HEADERS === 'undefined'){
    alert('Run this on demo.fnhub.app while signed in (SUPABASE_URL/HOUSING_HEADERS not found).');
    return;
  }
  var log = function(m){ console.log('%c[seed] ' + m, 'color:#9A4A1F;font-weight:600'); };
  var uid = function(){ return (crypto && crypto.randomUUID) ? crypto.randomUUID() : ('id-' + Math.random().toString(36).slice(2)); };
  var pick = function(a, i){ return a[i % a.length]; };
  var money = function(n){ return Math.round(n); };

  var FIRST = ['James','Mary','Robert','Linda','Michael','Sandra','William','Patricia','David','Barbara',
    'Joseph','Susan','Charles','Jessica','Thomas','Karen','Daniel','Nancy','Matthew','Lisa',
    'Anthony','Betty','Mark','Margaret','Paul','Dorothy','Steven','Helen','Kevin','Sharon',
    'Brian','Cynthia','George','Kathleen','Edward','Amy','Ronald','Angela','Timothy','Shirley',
    'Jason','Anna','Jeffrey','Ruth','Ryan','Brenda','Jacob','Pamela','Gary','Nicole'];
  var LAST = ['Sutherland','Wesley','Ferris','Neshinapaise','Sackaney','Moore','Spencer','Nakogee','Archibald','Louttit',
    'Wynne','Corston','Chum','Hookimaw','Metatawabin','Kataquapit','Faries','Cheechoo','Iahtail','Wabano',
    'Rickard','Echum','Tozer','Solomon','Bird','Turner','Gagnon','McKay','Linklater','Blueboy'];
  var STREETS = ['Birch','Cedar','Maple','Poplar','Spruce','Tamarack','Willow','Riverside','Lakeshore','Sunset'];
  var TYPES = ['Single','Semi','Duplex','Modular','Bungalow'];
  var FUNDERS = ['cmhc_95','section_10','band_house','band_rep'];
  var TRADES = ['General Contractor','Plumbing','Electrical','HVAC','Roofing'];

  // ---- 5 contractors --------------------------------------------------------
  var contractors = [];
  var COMPANY = ['Northern Build Co.','Moosonee Mechanical','Highway 11 Electric','James Bay Roofing','Boreal General Contracting'];
  for (var c = 0; c < 5; c++){
    var ct = {
      id: uid(),
      name: COMPANY[c],
      trade: TRADES[c],
      status: c < 3 ? 'approved' : (c === 3 ? 'hm_recommended' : 'pending_review'),
      email: 'contact@' + COMPANY[c].toLowerCase().replace(/[^a-z]+/g, '') + '.ca',
      phone: '705-555-' + String(1000 + c),
      address: (100 + c) + ' Industrial Rd, Hearst, ON',
      wsib: '2027-01-31', insurance: '2027-06-30',
      seed: true
    };
    if (typeof sbSaveContractor === 'function') { await sbSaveContractor(ct); }
    contractors.push(ct);
  }
  log('contractors: ' + contractors.length);

  // ---- 58 units (50 occupied + 8 vacant) ------------------------------------
  var units = [];
  var nameIdx = 0;
  for (var u = 0; u < 58; u++){
    var street = pick(STREETS, u);
    var num = String(2 + u * 2);
    var id = (street + '-' + num).toUpperCase();
    var beds = 1 + (u % 4);
    var occupied = u < 50;
    var tenantName = occupied ? (pick(FIRST, nameIdx) + ' ' + pick(LAST, nameIdx * 3 + 1)) : '';
    if (occupied) nameIdx++;
    var unit = {
      id: id,
      num: num,
      street: street + ' Street',
      bedrooms: beds,
      bathrooms: String(1 + (u % 2)),
      type: pick(TYPES, u),
      funder: pick(FUNDERS, u),
      status: occupied ? 'occupied' : 'vacant',
      monthlyRent: money(500 + beds * 150 + (u % 5) * 25),
      isElders: (u % 11 === 0),
      assignmentType: (u % 17 === 0 ? 'temporary' : (u % 23 === 0 ? 'transition' : '')),
      assignedName: tenantName || null,
      assignedTo: occupied ? ('seed-tenant-' + u) : null,
      assignedDate: occupied ? '2025-0' + (1 + (u % 9)) + '-15' : null,
      seed: true
    };
    if (typeof sbSaveUnit === 'function') { await sbSaveUnit(unit); }
    units.push(unit);
  }
  log('units: ' + units.length + ' (50 occupied -> tenants via trigger, 8 vacant)');

  // ---- 10 applications ------------------------------------------------------
  var appStatuses = ['submitted','submitted','mgr_approved','hm_approved','ed_approved','ed_approved','submitted','returned','ed_approved','mgr_approved'];
  var appTypes = ['new_housing','new_housing','new_housing','transfer_request','new_housing','new_housing','existing_tenant','new_housing','new_housing','transfer_request'];
  for (var a = 0; a < 10; a++){
    var fn = pick(FIRST, a * 5 + 2), ln = pick(LAST, a * 7 + 4);
    var beds = 1 + (a % 4);
    var app = {
      id: uid(),
      appType: appTypes[a],
      status: appStatuses[a],
      fn: fn, ln: ln,
      dob: '19' + (70 + a) + '-0' + (1 + (a % 8)) + '-1' + (a % 9),
      reserve: (a % 2 === 0) ? 'On Reserve' : 'Off Reserve',
      marital: (a % 3 === 0) ? 'Married' : 'Single',
      phone: '705-555-' + String(2000 + a),
      email: (fn + '.' + ln).toLowerCase() + '@example.com',
      bedroomsNeeded: beds,
      children: (a % 3),
      dependants: (a % 2),
      score: 40 + (a * 5) % 55,
      urgentNeed: (a % 4 === 0) ? 'overcrowded' : 'none',
      submittedAt: '2026-0' + (1 + (a % 8)) + '-10',
      seed: true
    };
    if (typeof sbSaveApplication === 'function') { await sbSaveApplication(app); }
  }
  log('applications: 10');

  // ---- Direct REST helper (SOWs / RFQs / projects) --------------------------
  async function post(table, row, prefer){
    var r = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
      method: 'POST',
      headers: Object.assign({}, HOUSING_HEADERS, { 'Prefer': prefer || 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(row)
    });
    if (!r.ok) console.warn('[seed] POST ' + table + ' failed', await r.text().catch(function(){return '';}));
    return r.ok;
  }

  // ---- 5 maintenance requests (SOWs) ----------------------------------------
  var sowUnits = units.slice(0, 5);
  var sowMeta = [];
  var SOW_TITLES = ['Furnace replacement','Bathroom mould remediation','Roof shingle repair','Kitchen cabinet rebuild','Window & door reseal'];
  for (var s = 0; s < 5; s++){
    var pn = 'SOW-2026-' + String(s + 1).padStart(2, '0');
    var cost = money(4000 + s * 2500);
    var sow = {
      id: uid(),
      project_number: pn,
      title: SOW_TITLES[s],
      unit_id: sowUnits[s].id,
      approval_status: (s < 2 ? 'ed_approved' : (s === 2 ? 'hm_approved' : (s === 3 ? 'submitted' : ''))),
      overall_condition: (s % 2 === 0) ? 'poor' : 'fair',
      assigned_team: (s % 2 === 0) ? 'contractor' : 'in_house',
      contractor_id: (s % 2 === 0) ? contractors[s % contractors.length].id : null,
      fund_source: 'band_house',
      items: [{ category: 'General', description: SOW_TITLES[s], cost: cost }],
      total_cost: cost,
      created_at: new Date().toISOString(),
      seed: true
    };
    await post('housing_sow', { unit_id: sowUnits[s].id, data: { sows: [sow] } });
    sowMeta.push({ unitId: sowUnits[s].id, pn: pn });
  }
  log('maintenance requests (SOWs): 5');

  // ---- 2 RFQs (linked to 2 SOWs) --------------------------------------------
  for (var q = 0; q < 2; q++){
    var m = sowMeta[q];
    await post('housing_rfq', {
      id: uid(),
      sow_unit_id: m.unitId,
      sow_project_number: m.pn,
      status: 'issued',
      issued_at: new Date().toISOString(),
      closes_at: new Date(Date.now() + 14 * 86400000).toISOString(),
      recipient_contractor_ids: [contractors[0].id, contractors[1].id],
      data: {
        contact_name: 'Housing Manager', contact_email: 'housing@demo.fnhub.app',
        scope_summary: 'Supply and install per the linked maintenance request.',
        seed: true
      }
    });
  }
  log('RFQs: 2');

  // ---- 2 capital projects ---------------------------------------------------
  var CP = [
    { name: 'Birch Subdivision - 20 Lot Development', type: 'lot_development', budget: 1200000, fund: 'ISC Capital' },
    { name: 'Cedar Crescent - 5 House Build',        type: 'house_build',     budget: 1750000, fund: 'CMHC Section 95' }
  ];
  for (var p = 0; p < 2; p++){
    await post('housing_projects', {
      id: uid(),
      project_number: 'CP-2026-' + String(p + 1).padStart(2, '0'),
      name: CP[p].name,
      type: CP[p].type,
      status: 'active',
      funding_source: CP[p].fund,
      budget: CP[p].budget,
      start_date: '2026-04-01',
      target_date: '2027-03-31',
      data: {
        description: 'Seeded demo capital project.',
        milestones: [
          { id: uid(), name: 'Funding confirmed', targetDate: '2026-04-15', done: true, completedDate: '2026-04-12' },
          { id: uid(), name: 'Site servicing',    targetDate: '2026-08-01', done: false },
          { id: uid(), name: 'Construction',      targetDate: '2027-01-15', done: false }
        ],
        expenses: [],
        grants: [{ id: uid(), source: CP[p].fund, reference: 'GA-2026-' + (100 + p), amount: CP[p].budget }],
        seed: true
      }
    }, 'return=minimal');
  }
  log('capital projects: 2');

  log('%cSEED COMPLETE — refresh the app to see the data.');
  console.log('%c[seed] SEED COMPLETE', 'color:#15803d;font-weight:700;font-size:14px');
})();
