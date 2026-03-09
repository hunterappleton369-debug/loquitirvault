/* ========================================
   Loquitir Landing Page — JavaScript
   ======================================== */

(function () {
  'use strict';

  // --- DOM Elements ---
  var navbar = document.getElementById('navbar');
  var mobileToggle = document.getElementById('mobileToggle');
  var navLinks = document.getElementById('navLinks');
  var form = document.getElementById('agentForm');
  var submitBtn = document.getElementById('submitBtn');
  var formSuccess = document.getElementById('formSuccess');
  var formError = document.getElementById('formError');

  var WEBHOOK_URL = 'https://hook.us2.make.com/x8lexiu5f4n6q174dbo6zrwwtrwcdwsn';

  // --- Mobile Nav Overlay ---
  var overlay = null;

  function createOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'nav-overlay';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', closeMobileNav);
  }

  function openMobileNav() {
    navLinks.classList.add('open');
    mobileToggle.classList.add('active');
    if (overlay) overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeMobileNav() {
    navLinks.classList.remove('open');
    mobileToggle.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  // --- Navbar Scroll Effect ---
  function handleScroll() {
    if (window.scrollY > 10) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  }

  // --- Smooth Scroll ---
  function handleAnchorClicks() {
    document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
      anchor.addEventListener('click', function (e) {
        var targetId = this.getAttribute('href');
        if (targetId === '#') return;
        var target = document.querySelector(targetId);
        if (!target) return;
        e.preventDefault();
        closeMobileNav();
        var offset = navbar.offsetHeight + 16;
        var top = target.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({ top: top, behavior: 'smooth' });
      });
    });
  }

  // --- Phone Number Formatting ---
  function formatPhoneNumber(value) {
    var cleaned = value.replace(/\D/g, '');
    if (cleaned.length === 0) return '';
    if (cleaned.length <= 3) return '(' + cleaned;
    if (cleaned.length <= 6) return '(' + cleaned.slice(0, 3) + ') ' + cleaned.slice(3);
    return '(' + cleaned.slice(0, 3) + ') ' + cleaned.slice(3, 6) + '-' + cleaned.slice(6, 10);
  }

  function setupPhoneFormatting() {
    var phoneInput = document.getElementById('phone');
    if (!phoneInput) return;
    phoneInput.addEventListener('input', function () {
      var cursorPos = this.selectionStart;
      var prevLen = this.value.length;
      this.value = formatPhoneNumber(this.value);
      var newLen = this.value.length;
      var newPos = cursorPos + (newLen - prevLen);
      this.setSelectionRange(newPos, newPos);
    });
  }

  // --- Form Validation ---
  function validateField(field) {
    var group = field.closest('.form-group');
    if (!group) return true;
    var isValid = true;

    if (field.required && !field.value.trim()) {
      isValid = false;
    } else if (field.type === 'email' && field.value.trim()) {
      isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field.value.trim());
    } else if (field.id === 'phone' && field.value.trim()) {
      var digits = field.value.replace(/\D/g, '');
      isValid = digits.length >= 10;
    } else if (field.id === 'websiteUrl' && field.value.trim()) {
      // Accept URLs with or without protocol, ports, paths, query strings
      var url = field.value.trim();
      isValid = /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}/i.test(url);
    }

    if (isValid) {
      group.classList.remove('has-error');
      field.classList.remove('invalid');
    } else {
      group.classList.add('has-error');
      field.classList.add('invalid');
    }

    return isValid;
  }

  function validateForm() {
    var fields = form.querySelectorAll('input[required]');
    var allValid = true;
    fields.forEach(function (field) {
      if (!validateField(field)) {
        allValid = false;
      }
    });
    // Also validate optional fields that have values
    var optionalFields = form.querySelectorAll('input:not([required])');
    optionalFields.forEach(function (field) {
      if (field.value.trim() && !validateField(field)) {
        allValid = false;
      }
    });
    return allValid;
  }

  function setupLiveValidation() {
    var fields = form.querySelectorAll('input, select, textarea');
    fields.forEach(function (field) {
      field.addEventListener('blur', function () {
        validateField(this);
      });
      field.addEventListener('input', function () {
        if (this.closest('.form-group').classList.contains('has-error')) {
          validateField(this);
        }
      });
    });
  }

  // --- Form Submission ---
  function handleSubmit(e) {
    e.preventDefault();

    // Hide previous messages
    formSuccess.style.display = 'none';
    formError.style.display = 'none';

    if (!validateForm()) return;

    // Collect data — new fields matching updated form
    var data = {
      fullName: document.getElementById('fullName').value.trim(),
      email: document.getElementById('email').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      websiteUrl: document.getElementById('websiteUrl').value.trim(),
      afterHoursAnswer: document.getElementById('afterHoursAnswer').value.trim()
    };

    // Show loading state
    var btnText = submitBtn.querySelector('.btn-text');
    var btnLoading = submitBtn.querySelector('.btn-loading');
    btnText.style.display = 'none';
    btnLoading.style.display = 'inline-flex';
    submitBtn.disabled = true;

    // Send to webhook
    fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
      .then(function (response) {
        if (!response.ok) throw new Error('Network response was not ok');
        formSuccess.style.display = 'flex';
        form.reset();
        // Clear any validation states
        form.querySelectorAll('.form-group').forEach(function (g) {
          g.classList.remove('has-error');
        });
        form.querySelectorAll('input, select, textarea').forEach(function (f) {
          f.classList.remove('invalid');
        });
      })
      .catch(function () {
        formError.style.display = 'block';
      })
      .finally(function () {
        btnText.style.display = 'inline';
        btnLoading.style.display = 'none';
        submitBtn.disabled = false;
      });
  }

  // --- Init ---
  function init() {
    createOverlay();

    // Navbar scroll
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    // Mobile nav toggle
    if (mobileToggle) {
      mobileToggle.addEventListener('click', function () {
        if (navLinks.classList.contains('open')) {
          closeMobileNav();
        } else {
          openMobileNav();
        }
      });
    }

    // Smooth scroll
    handleAnchorClicks();

    // Phone formatting
    setupPhoneFormatting();

    // Form
    if (form) {
      setupLiveValidation();
      form.addEventListener('submit', handleSubmit);
    }
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
