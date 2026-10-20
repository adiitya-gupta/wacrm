/**
 * WACRM Lightweight Website Integration SDK
 * Zero-dependency browser script for website lead capture & event automation
 */
(function (window, document) {
  'use strict';

  var currentScript =
    document.currentScript ||
    document.querySelector('script[data-site-key]');

  var config = {
    siteKey: currentScript ? currentScript.getAttribute('data-site-key') : null,
    apiHost:
      (currentScript ? currentScript.getAttribute('data-api-host') : null) ||
      (currentScript && currentScript.src ? new URL(currentScript.src).origin : window.location.origin),
  };

  var WACRM = {
    init: function (options) {
      if (!options) return;
      if (options.siteKey) config.siteKey = options.siteKey;
      if (options.apiHost) config.apiHost = options.apiHost;
    },

    track: function (eventType, payload, callback) {
      if (!config.siteKey) {
        console.warn('[WACRM SDK] Missing siteKey. Initialize with data-site-key on the script tag or call WACRM.init({ siteKey: "..." })');
        if (callback) callback(new Error('Missing siteKey'));
        return;
      }

      var data = payload || {};
      data.event_type = eventType || 'lead.submitted';

      var endpoint = config.apiHost + '/api/v1/website/sdk-events';

      fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-site-key': config.siteKey,
        },
        body: JSON.stringify(data),
      })
        .then(function (res) {
          return res.json().then(function (json) {
            return { ok: res.ok, status: res.status, data: json };
          });
        })
        .then(function (result) {
          if (!result.ok) {
            throw new Error(result.data.error || 'Failed to submit event to WACRM');
          }
          if (window.dispatchEvent) {
            var evt = new CustomEvent('wacrm:event_sent', { detail: result.data });
            window.dispatchEvent(evt);
          }
          if (callback) callback(null, result.data);
        })
        .catch(function (err) {
          console.error('[WACRM SDK] Event tracking error:', err);
          if (callback) callback(err);
        });
    },

    bindForm: function (formSelector, options) {
      var opts = options || {};
      var form = document.querySelector(formSelector);
      if (!form) {
        console.warn('[WACRM SDK] Form element not found for selector:', formSelector);
        return;
      }

      form.addEventListener('submit', function (e) {
        var formData = new FormData(form);
        var payload = {};

        formData.forEach(function (value, key) {
          payload[key] = value;
        });

        // Resolve phone field
        var phone =
          payload.phone ||
          payload.tel ||
          payload.mobile ||
          payload.whatsapp ||
          payload.phoneNumber;

        var name =
          payload.name ||
          payload.full_name ||
          payload.fullName ||
          (payload.first_name ? payload.first_name + ' ' + (payload.last_name || '') : '');

        var email = payload.email || payload.user_email;

        if (phone) {
          WACRM.track(
            opts.event || 'lead.submitted',
            {
              phone: String(phone).trim(),
              name: name ? String(name).trim() : undefined,
              email: email ? String(email).trim() : undefined,
              metadata: payload,
            },
            opts.onSuccess
          );
        }
      });
    },
  };

  window.WACRM = WACRM;
})(window, document);
