/* Home Land Homes — marketing site JS.
   Progressive enhancement only: the page is fully readable with JS disabled. */

(function () {
  "use strict";

  /* ── SITE CONFIG — the only things you should need to edit ─────────────
     formEndpoint: a URL that accepts a JSON POST of the demo-request form
                   (e.g. a Cloudflare Worker or form service you control).
                   Leave "" to fall back to a pre-filled mailto: draft.
     contactEmail: real contact inbox. Leave "" until confirmed — the form
                   then shows a "not configured yet" notice instead of
                   silently sending nowhere.
     appLoginUrl:  the live app's login URL (links only — no shared code,
                   cookies, or sessions with this site).                  */
  var SITE_CONFIG = {
    formEndpoint: "",
    contactEmail: "hello@homelandhomes.ca",
    appLoginUrl: "https://fnhub.app"
  };

  document.documentElement.classList.add("js");

  /* ── Mobile nav ── */
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });
    // Close the menu when a link inside it is chosen
    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("open")) {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.focus();
      }
    });
  }

  /* ── Footer conveniences ── */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  var footEmail = document.getElementById("footer-contact-email");
  if (footEmail && SITE_CONFIG.contactEmail) {
    var a = document.createElement("a");
    a.href = "mailto:" + SITE_CONFIG.contactEmail;
    a.textContent = SITE_CONFIG.contactEmail;
    footEmail.replaceWith(a);
  }

  /* ── Reveal on scroll (skipped for reduced motion; CSS hides nothing
        unless html.js is present, so no-JS users always see content) ── */
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var revealEls = document.querySelectorAll(".reveal");
  if (!reduced && "IntersectionObserver" in window && revealEls.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("in"); });
  }

  /* ── Needs assessment (all local — nothing is transmitted or stored) ── */
  var ASSESS = {
    staffRate: 35, // assumed fully-loaded $/hour for staff time; footnote discloses it
    tiers: {
      small: { label: "Small community (up to 100 homes)",  monthly: 395,  annual: 4740,  setup: 2500 },
      mid:   { label: "Mid-size community (101–300 homes)", monthly: 695,  annual: 8340,  setup: 4500 },
      large: { label: "Large community (301–600 homes)",    monthly: 1095, annual: 13140, setup: 7500 },
      xl:    { label: "600+ homes / Tribal Council",         monthly: 0,    annual: 0,     setup: 0 }
    }
  };

  function fmtCad(n) {
    return "$" + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  var needsForm = document.getElementById("needs-form");
  var needsResult = document.getElementById("needs-result");
  var needsStatus = document.getElementById("needs-status");

  // Per-feature benefit lines, keyed to the checkboxes in questions 5 and 6.
  var FEATURE_BULLETS = {
    applications: "Applications score themselves against your policy — the waitlist ranks fairly and defensibly, with an approval trail.",
    matching:     "Approved applicants are matched to vacant units by configurable priority — no more whiteboard debates.",
    maintenance:  "Tenants scan a QR code to report an issue with photos — it arrives as a trackable work order, not a phone message.",
    renos:        "Renovation scopes, RFQs, bids and awarded contracts flow through one tender process with generated paperwork.",
    contractors:  "Contractor approvals, insurance and WSIB expiries are tracked so nothing lapses unnoticed.",
    inspections:  "Room-by-room condition reports with photos, on a phone, that can spawn work orders on the spot.",
    projects:     "Capital projects tracked from funding to finished homes — milestone budgets, multi-grant funding, and one-click claim packages with every invoice, EFT and bank statement your funder demands.",
    finance:      "Rent, arrears, arrangements and collections reconcile in the same system the housing team uses — statements and receipts email to tenants as PDFs.",
    portal:       "Tenants and applicants apply, upload documents and get status updates online — without calling the office.",
    council:      "The leadership Reports dashboard gives Chief & Council a live, read-only picture — no more assembling reports by hand.",
    ai:           "Staff ask plain-language questions and get answers from your nation's own records — read-only and permission-aware.",
    audit:        "Every change is logged to a tamper-resistant audit trail, with role-based permissions on every action."
  };

  if (needsForm && needsResult) {
    needsForm.addEventListener("submit", function (e) {
      e.preventDefault();

      function picked(name) {
        var el = needsForm.querySelector('input[name="' + name + '"]:checked');
        return el ? el.value : null;
      }
      function pickedAll(name) {
        var els = needsForm.querySelectorAll('input[name="' + name + '"]:checked');
        return Array.prototype.map.call(els, function (el) { return el.value; });
      }
      function labelsFor(name) {
        var els = needsForm.querySelectorAll('input[name="' + name + '"]:checked');
        return Array.prototype.map.call(els, function (el) {
          return el.parentNode.querySelector("span").textContent;
        }).join(", ");
      }

      var homes = picked("na_homes");
      var tracking = pickedAll("na_tracking");
      var channels = pickedAll("na_maint");
      var hours = picked("na_hours");
      var features = pickedAll("na_features");

      if (!homes || !hours || !tracking.length || !channels.length || !features.length) {
        needsStatus.textContent = "Please answer every question — pick as many options as apply.";
        needsStatus.setAttribute("data-state", "error");
        return;
      }
      needsStatus.textContent = "";
      needsStatus.removeAttribute("data-state");

      var tier = ASSESS.tiers[homes];
      var staffCost = Number(hours) * ASSESS.staffRate * 52;
      var totalFeatures = Object.keys(FEATURE_BULLETS).length;

      // Every selection feeds the story: record sources -> migration scope,
      // contact channels -> intake bullet, features -> included-value math.
      var bullets = [];

      var sources = tracking.filter(function (t) { return t !== "memory"; }).length;
      if (sources > 1) {
        bullets.push("Setup consolidates your " + sources + " current record sources into one system — migration is what the setup fee covers.");
      } else if (tracking.indexOf("paper") !== -1) {
        bullets.push("Your paper files and binders are migrated for you — that is exactly what the setup fee covers.");
      } else if (tracking.indexOf("sheets") !== -1) {
        bullets.push("Your spreadsheets become one shared system — migration is included in setup, so nothing is retyped twice.");
      } else if (tracking.indexOf("software") !== -1) {
        bullets.push("Everything your current system does, plus the modules it doesn't have — with your data in your nation's own database.");
      }
      if (tracking.indexOf("memory") !== -1) {
        bullets.push("What lives in staff's heads becomes a record the whole team can see — and that survives staff turnover.");
      }

      var offlineChannels = channels.filter(function (c) { return c !== "online"; }).length;
      if (offlineChannels > 0) {
        bullets.push("The " + (offlineChannels > 1 ? offlineChannels + " scattered ways tenants reach you" : "phone-and-paper intake") +
          " become one queue — QR-code requests with photos arrive as trackable work orders.");
      } else {
        bullets.push("Your online intake connects straight through to work orders, contractors and inspections — end to end.");
      }

      // Feature bullets: show up to 4 of what they picked, in question order.
      var shown = 0;
      for (var i = 0; i < features.length && shown < 4; i++) {
        if (FEATURE_BULLETS[features[i]]) { bullets.push(FEATURE_BULLETS[features[i]]); shown++; }
      }
      bullets.push("All of it in your nation's own Canadian-hosted database — never pooled with anyone else's, never sold, never mined.");

      var html = "<h3>Your results</h3>";
      if (homes === "xl") {
        html += "<p>At your size, pricing is a custom conversation — group and Tribal Council rates are available.</p>";
        html += "<p class=\"ar-cost\">By your own numbers, roughly <em>" + fmtCad(staffCost) +
                "/year of staff time</em> currently goes into manual tracking and reporting.</p>";
      } else {
        html += "<p><strong>Recommended plan:</strong> " + tier.label + " — " +
                fmtCad(tier.monthly) + "/month (" + fmtCad(tier.annual) + "/year) plus a one-time " +
                fmtCad(tier.setup) + " setup, half price if you sign a one-year term and pay the year up front.</p>";
        html += "<p class=\"ar-cost\">By your own numbers, roughly <em>" + fmtCad(staffCost) +
                "/year of staff time</em> currently goes into manual tracking and reporting — against " +
                fmtCad(tier.annual) + "/year for the platform.</p>";
        html += "<p>You picked <strong>" + features.length + " of " + totalFeatures +
                " capabilities</strong> — every one is included in the flat price, which works out to about <strong>" +
                fmtCad(tier.monthly / features.length) + "/month per capability</strong>. Nothing you selected costs extra.</p>";
      }
      html += "<ul><li>" + bullets.join("</li><li>") + "</li></ul>";
      html += "<div class=\"ar-ctas\">" +
              "<a class=\"btn btn-primary\" href=\"#demo\" id=\"ar-demo-btn\">Book a demo with these answers</a>" +
              "<a class=\"btn btn-ghost\" href=\"#pricing\">See full pricing</a></div>";

      needsResult.innerHTML = html;
      needsResult.hidden = false;
      needsResult.scrollIntoView({ behavior: "smooth", block: "nearest" });

      // Hand the answers to the demo form so the conversation starts warm
      var demoBtn = document.getElementById("ar-demo-btn");
      if (demoBtn) {
        demoBtn.addEventListener("click", function () {
          var msg = document.getElementById("f-msg");
          if (msg && !msg.value.trim()) {
            msg.value = "Needs check: " + labelsFor("na_homes") + " homes. Records today: " +
              labelsFor("na_tracking") + ". Tenants reach us via: " + labelsFor("na_maint") +
              ". ~" + labelsFor("na_hours") + " staff-hours/week on manual admin. Interested in: " +
              labelsFor("na_features") + ".";
          }
        });
      }
    });
  }

  /* ── Demo-request form ── */
  var form = document.getElementById("demo-form");
  var status = document.getElementById("form-status");

  function setStatus(msg, state) {
    if (!status) return;
    status.textContent = msg;
    status.setAttribute("data-state", state || "");
  }

  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();

      // Native validation with a friendly nudge
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      var data = {
        name: form.name.value.trim(),
        organization: form.organization.value.trim(),
        role: form.role.value,
        email: form.email.value.trim(),
        message: form.message.value.trim(),
        source: "marketing-site"
      };

      if (SITE_CONFIG.formEndpoint) {
        setStatus("Sending…", "");
        fetch(SITE_CONFIG.formEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        }).then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          form.reset();
          setStatus("Thanks — we'll be in touch shortly.", "ok");
        }).catch(function () {
          setStatus("Something went wrong sending the form. Please try again, or email us directly.", "error");
        });
      } else if (SITE_CONFIG.contactEmail) {
        // Mailto fallback: open a pre-filled draft in the visitor's mail app
        var body =
          "Name: " + data.name + "\n" +
          "Nation / organization: " + data.organization + "\n" +
          "Role: " + (data.role || "-") + "\n" +
          "Email: " + data.email + "\n\n" +
          (data.message || "");
        var href = "mailto:" + SITE_CONFIG.contactEmail +
          "?subject=" + encodeURIComponent("Demo request — " + data.organization) +
          "&body=" + encodeURIComponent(body);
        window.location.href = href;
        setStatus("Opening your email app with a pre-filled message…", "ok");
      } else {
        setStatus("The contact form isn't wired up yet (no endpoint or email configured). See assets/js/main.js.", "error");
      }
    });
  }
})();
