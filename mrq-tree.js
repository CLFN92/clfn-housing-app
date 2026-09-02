// mrq-tree.js — the maintenance-request questionnaire DATA TREE, shared by
// the staff Renovation Questionnaire (reno-questionnaire.js, housing.html)
// and the tenant Member Portal's guided report flow (apply.js, portal.html).
// Single source: edit trades/components/issues HERE. Each trade's `cat` must
// match SOW_CATEGORIES (housing-modals-sow.js).
window.MRQ_TREE = {
  ROOMS: ['Kitchen','Bathroom','Bedroom','Living Room','Hallway / Stairs',
               'Basement','Laundry','Utility / Mechanical','Exterior','Whole Unit'],
  TRADES: [
    { cat:'Plumbing', icon:'🚰', components:[
      { label:'Toilet',          issues:['Will not flush','Constantly running','Leaking at base','Tank / bowl cracked','Loose / rocks','Clogged','Seal / wax ring'] },
      { label:'Faucet / Tap',    issues:['Dripping / leaking','No or low pressure','No hot water','Handle broken','Leaking under sink','Corroded'] },
      { label:'Sink / Basin',    issues:['Drain clogged','Cracked / chipped','Leaking','Loose from wall'] },
      { label:'Bathtub / Shower',issues:['No hot water','Low pressure','Drain clogged','Cracked / chipped','Caulking / mould','Diverter broken'] },
      { label:'Water Heater',    issues:['No hot water','Leaking tank','Pilot / element','Noisy','Not enough hot water'] },
      { label:'Pipes / Drain',   issues:['Active leak','Frozen','Burst','Slow drain','Sewer smell / backup'] },
      { label:'Sump Pump',       issues:['Not working','Running constantly','Noisy'] }
    ]},
    { cat:'Electrical', icon:'💡', components:[
      { label:'Outlet / Receptacle', issues:['No power','Sparking / burnt','Loose / damaged','Not grounded','Warm to touch'] },
      { label:'Light Fixture',       issues:['Not working','Flickering','Broken / damaged','Missing','Cover missing'] },
      { label:'Switch',              issues:['Not working','Sparking','Loose','Warm to touch'] },
      { label:'Breaker / Panel',     issues:['Trips repeatedly','No power to area','Buzzing / humming','Burning smell','Label / cover missing'] },
      { label:'Smoke / CO Detector', issues:['Not working','Chirping / beeping','Missing','Expired','Disconnected'] },
      { label:'Wiring',              issues:['Exposed / unsafe','Burning smell','Knob & tube / old','Junction box open'] },
      { label:'Exterior Light',      issues:['Not working','Broken','Missing'] }
    ]},
    { cat:'Windows & Doors', icon:'🚪', components:[
      { label:'Window',         issues:['Will not open / close','Broken glass','Foggy / failed seal','Drafty','Lock / latch broken','Screen damaged','Rotted / damaged frame'] },
      { label:'Exterior Door',  issues:['Will not close / latch','Lock / deadbolt broken','Drafty','Damaged / rotted','Weatherstripping','Threshold damaged'] },
      { label:'Interior Door',  issues:['Will not close','Off the hinges','Hole / damage','Handle / latch broken','Missing'] },
      { label:'Patio / Sliding',issues:['Will not slide','Off track','Glass broken','Lock broken','Drafty'] },
      { label:'Storm Door',     issues:['Closer broken','Glass / screen damaged','Will not close'] }
    ]},
    { cat:'Heating / HVAC', icon:'🔥', components:[
      { label:'Furnace',           issues:['No heat','Short cycling','Noisy','Pilot / ignition','Filter / maintenance'] },
      { label:'Baseboard Heater',  issues:['No heat','Overheating','Damaged','Thermostat not working'] },
      { label:'Thermostat',        issues:['Not working','Inaccurate','Blank / no power'] },
      { label:'Ventilation / Fan', issues:['Not working','Noisy','Mould / dirty','Duct disconnected'] },
      { label:'Heat Pump / AC',    issues:['No heat','No cooling','Noisy','Leaking','Not turning on'] }
    ]},
    { cat:'Flooring', icon:'🪵', components:[
      { label:'Subfloor',      issues:['Soft / rotted','Squeaking','Uneven / sagging','Water damage'] },
      { label:'Finished Floor',issues:['Damaged / cracked','Lifting / peeling','Water damage','Worn out','Buckling'] },
      { label:'Carpet',        issues:['Stained','Torn / worn','Odour','Loose / tripping'] },
      { label:'Tile',          issues:['Cracked','Loose','Grout failing'] }
    ]},
    { cat:'Interior Walls / Drywall', icon:'🧱', components:[
      { label:'Drywall',          issues:['Hole','Crack','Water damage','Mould','Nail pops'] },
      { label:'Ceiling',          issues:['Water stain','Sagging','Crack','Hole'] },
      { label:'Trim / Baseboard', issues:['Damaged','Missing','Detached'] }
    ]},
    { cat:'Kitchen', icon:'🍳', components:[
      { label:'Cabinets',    issues:['Doors broken / off','Water damage','Missing hardware','Shelf broken'] },
      { label:'Countertop',  issues:['Damaged / cracked','Burned','Lifting / delaminating'] },
      { label:'Stove / Oven',issues:['Not working','Element / burner out','Door / seal','Hood fan'] },
      { label:'Fridge',      issues:['Not cooling','Leaking','Noisy','Seal damaged'] },
      { label:'Sink Area',   issues:['Backsplash damaged','Caulking'] }
    ]},
    { cat:'Bathroom', icon:'🛁', components:[
      { label:'Vanity / Cabinet', issues:['Water damage','Doors broken','Countertop damaged'] },
      { label:'Exhaust Fan',      issues:['Not working','Noisy','Mould / dirty','Missing'] },
      { label:'Tile / Surround',  issues:['Cracked','Mould','Loose','Grout / caulking failing'] },
      { label:'Mirror / Accessory',issues:['Broken','Missing','Loose'] }
    ]},
    { cat:'Roofing', icon:'🏠', components:[
      { label:'Shingles',     issues:['Missing','Damaged / curling','Active leak'] },
      { label:'Soffit / Fascia',issues:['Damaged','Rotted','Detached'] },
      { label:'Eavestrough',  issues:['Clogged','Leaking','Detached / sagging'] },
      { label:'Flashing / Vent',issues:['Leaking','Damaged','Missing'] }
    ]},
    { cat:'Exterior Walls / Siding', icon:'🧱', components:[
      { label:'Siding',     issues:['Damaged','Missing','Rotted','Loose'] },
      { label:'Trim / Corners',issues:['Damaged','Rotted','Missing'] },
      { label:'Caulking / Seal',issues:['Failing','Missing','Gap / draft'] }
    ]},
    { cat:'Foundation / Structure', icon:'🏗️', components:[
      { label:'Foundation',     issues:['Cracks','Water / seepage','Settling / heaving'] },
      { label:'Framing',        issues:['Rot','Damage','Sagging'] },
      { label:'Stairs / Railing',issues:['Loose','Broken','Missing','Rotted'] },
      { label:'Deck / Porch',   issues:['Rotted','Loose / unsafe','Railing'] }
    ]},
    { cat:'Insulation', icon:'🧣', components:[
      { label:'Attic / Ceiling', issues:['Missing / inadequate','Wet / damaged'] },
      { label:'Wall',            issues:['Missing / inadequate','Draft / cold spot'] },
      { label:'Pipes / Ducts',   issues:['Missing','Frozen risk'] }
    ]},
    { cat:'Painting', icon:'🎨', components:[
      { label:'Walls',   issues:['Peeling','Stained','Needs repaint','Patch & paint'] },
      { label:'Ceiling', issues:['Stained','Peeling','Needs repaint'] },
      { label:'Trim / Doors',issues:['Chipped','Needs repaint'] }
    ]},
    { cat:'Accessibility Modifications', icon:'♿', components:[
      { label:'Grab Bars',    issues:['Install required','Loose','Relocate'] },
      { label:'Ramp',         issues:['Install required','Repair','Railing'] },
      { label:'Door Widening',issues:['Required for mobility'] },
      { label:'Bathroom Mods',issues:['Walk-in / roll-in shower','Raised toilet','Other mod'] }
    ]},
    { cat:'Other', icon:'🔧', components:[
      { label:'General / Other', issues:['Describe in details'] }
    ]}
  ]
};
