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
    contactEmail: "",
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

  if (needsForm && needsResult) {
    needsForm.addEventListener("submit", function (e) {
      e.preventDefault();

      function picked(name) {
        var el = needsForm.querySelector('input[name="' + name + '"]:checked');
        return el ? el.value : null;
      }
      function pickedLabel(name) {
        var el = needsForm.querySelector('input[name="' + name + '"]:checked');
        return el ? el.parentNode.querySelector("span").textContent : "";
      }

      var homes = picked("na_homes");
      var tracking = picked("na_tracking");
      var maint = picked("na_maint");
      var hours = picked("na_hours");
      var priority = picked("na_priority");

      if (!homes || !tracking || !maint || !hours || !priority) {
        needsStatus.textContent = "Please answer all five questions first.";
        needsStatus.setAttribute("data-state", "error");
        return;
      }
      needsStatus.textContent = "";
      needsStatus.removeAttribute("data-state");

      var tier = ASSESS.tiers[homes];
      var staffCost = Number(hours) * ASSESS.staffRate * 52;

      var bullets = [];
      if (tracking === "paper") {
        bullets.push("Your paper files and binders are migrated for you — that is exactly what the setup fee covers.");
      } else if (tracking === "sheets") {
        bullets.push("Your spreadsheets become one shared system — migration is included in setup, so nothing is retyped twice.");
      } else if (tracking === "software") {
        bullets.push("Everything your current system does, plus applications with scoring, tendering, finance and a tenant portal — with your data in your nation's own database.");
      } else {
        bullets.push("One connected system replaces the mix — applications, homes, maintenance and rent stop living in separate places.");
      }
      if (maint === "online") {
        bullets.push("Your online intake connects straight through to work orders, contractors and inspections — end to end.");
      } else {
        bullets.push("Tenants scan a QR code and submit a maintenance request with photos — it arrives as a trackable work order, not a phone message.");
      }
      if (priority === "sovereignty") {
        bullets.push("Your records live in your nation's own Canadian-hosted database — never pooled with anyone else's, never sold, never mined.");
      } else if (priority === "paperwork") {
        bullets.push("Staff enter things once. Approvals, letters, work orders and reports come out of the same record — no more retyping.");
      } else if (priority === "council") {
        bullets.push("The Chief & Council dashboard gives leadership a live, read-only picture — no more assembling reports by hand.");
      } else {
        bullets.push("Tenants apply online, upload documents and hear back automatically at every step — no more chasing the office.");
      }

      var html = "<h3>Your results</h3>";
      if (homes === "xl") {
        html += "<p>At your size, pricing is a custom conversation — group and Tribal Council rates are available.</p>";
      } else {
        html += "<p><strong>Recommended plan:</strong> " + tier.label + " — " +
                fmtCad(tier.monthly) + "/month (" + fmtCad(tier.annual) + "/year) plus a one-time " +
                fmtCad(tier.setup) + " setup, half price if you sign a one-year term and pay the year up front.</p>";
      }
      html += "<p class=\"ar-cost\">By your own numbers, roughly <em>" + fmtCad(staffCost) +
              "/year of staff time</em> currently goes into manual tracking and reporting" +
              (homes !== "xl" ? " — against " + fmtCad(tier.annual) + "/year for the platform." : ".") + "</p>";
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
            msg.value = "Needs check: " + pickedLabel("na_homes") + " homes; tracking today: " +
              pickedLabel("na_tracking") + "; maintenance via " + pickedLabel("na_maint") +
              "; ~" + pickedLabel("na_hours") + " staff-hours/week on manual admin; top priority: " +
              pickedLabel("na_priority") + ".";
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
