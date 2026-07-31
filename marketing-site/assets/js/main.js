/* Homelands Housing — marketing site JS.
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
