// Renders a pending Kudos agency claim with Approve / Reject (used by claim.html and review.html).
// renderClaimCard(el, claim, { submit(action, agentId), search(text) })
(function () {
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const domain = (s) =>
    String(s || '').toLowerCase().trim().replace(/^.*@/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  const href = (w) => (!w ? '' : /^https?:\/\//i.test(w) ? w : `https://${w}`);

  window.renderClaimCard = function (el, d, opts) {
    const na = d.new_agency;
    const a = d.agent;
    const emailDomain = domain(d.email);
    const siteDomain = domain(a ? a.website : na && na.website);
    const when = d.requested_at ? new Date(d.requested_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

    el.innerHTML = `
      <div class="claim">
        <div class="claim-main">
          <div class="claim-label">${na ? 'New agency (not on Kudos yet)' : 'Agency'}</div>
          <div class="claim-name">${esc(a ? a.name : na.new_agency)}</div>
          <div class="claim-meta">
            ${siteDomain ? `<a href="${esc(href(a ? a.website : na.website))}" target="_blank" rel="noopener">${esc(siteDomain)}</a>` : '<span>No website on file</span>'}
            ${(a ? a.country : na.country) ? ` · ${esc(a ? a.country : na.country)}` : ''}
            ${a ? ` · ${a.awards} award${a.awards === 1 ? '' : 's'} on Kudos · <a href="${esc(a.kudos_url)}" target="_blank" rel="noopener">Kudos profile ↗</a>` : ''}
          </div>
          <div class="claim-label" style="margin-top:14px">Requested by</div>
          <div><strong>${esc(d.email)}</strong>${when ? ` <span class="muted">· ${esc(when)}</span>` : ''}</div>
          <div class="claim-warn">${
            !siteDomain
              ? 'There is no website on file, so the email domain could not be checked.'
              : `Email domain <strong>${esc(emailDomain)}</strong> doesn't match <strong>${esc(siteDomain)}</strong>. Check they work at the agency before approving.`
          }</div>
          ${
            na
              ? `<div class="claim-label" style="margin-top:14px">Link to agent record</div>
                 <input type="text" class="claim-search" placeholder="Search agents by name…" value="${esc(na.new_agency)}">
                 <div class="claim-results"></div>
                 <div class="muted" style="font-size:12px;margin-top:6px">Not listed? Add the agent in the incident widget first, then search again.</div>`
              : ''
          }
        </div>
        <div class="claim-actions">
          <button class="approve">Approve</button>
          <button class="reject">Reject</button>
          <div class="claim-result"></div>
        </div>
      </div>`;

    let agentId = null;
    const approve = el.querySelector('.approve');
    const reject = el.querySelector('.reject');
    const result = el.querySelector('.claim-result');

    if (na) {
      approve.disabled = true;
      const input = el.querySelector('.claim-search');
      const box = el.querySelector('.claim-results');
      let timer;
      const run = async () => {
        const list = await opts.search(input.value).catch(() => []);
        box.innerHTML = list.length
          ? list
              .map(
                (r) =>
                  `<label class="claim-pick"><input type="radio" name="pick-${esc(d.account_id)}" value="${esc(r.id)}"> <strong>${esc(r.name)}</strong> <span class="muted">${esc([r.country, domain(r.website)].filter(Boolean).join(' · '))}</span></label>`
              )
              .join('')
          : '<div class="muted" style="font-size:13px;padding:6px 0">No matching agents.</div>';
        box.querySelectorAll('input').forEach((i) =>
          i.addEventListener('change', () => {
            agentId = i.value;
            approve.disabled = false;
          })
        );
      };
      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(run, 300);
      });
      run();
    }

    const go = async (action) => {
      if (action === 'reject' && !confirm(`Reject ${d.email}'s claim?`)) return;
      approve.disabled = reject.disabled = true;
      result.textContent = action === 'approve' ? 'Approving…' : 'Rejecting…';
      const r = await opts.submit(action, agentId);
      if (r.ok) {
        result.innerHTML =
          action === 'approve'
            ? `<span class="ok">✓ Approved as ${r.role === 'member' ? 'a team member' : 'owner'}. ${esc(d.email)} has been sent a welcome email.</span>`
            : '<span class="bad">Rejected.</span>';
        approve.remove();
        reject.remove();
      } else {
        result.innerHTML = `<span class="bad">${esc(r.message || 'Something went wrong.')}</span>`;
        approve.disabled = na && !agentId;
        reject.disabled = false;
      }
    };
    approve.addEventListener('click', () => go('approve'));
    reject.addEventListener('click', () => go('reject'));
  };

  // Shared styles.
  const css = document.createElement('style');
  css.textContent = `
    .claim { display:grid; grid-template-columns: 1fr 200px; gap:18px; background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:18px; margin-bottom:14px; }
    .claim-label { font-size:11px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:#6b7280; }
    .claim-name { font-size:18px; font-weight:700; margin:2px 0 4px; }
    .claim-meta { font-size:13px; color:#374151; }
    .claim-warn { margin-top:12px; font-size:13px; background:#fffbeb; border:1px solid #fde68a; color:#92400e; border-radius:8px; padding:8px 10px; }
    .claim-search { width:100%; padding:8px 10px; border:1px solid #d1d5db; border-radius:8px; font:inherit; margin-top:4px; }
    .claim-results { margin-top:6px; max-height:220px; overflow:auto; }
    .claim-pick { display:block; padding:6px 4px; border-top:1px solid #f3f4f6; font-size:13px; cursor:pointer; font-weight:400; margin:0; }
    .claim-actions { display:flex; flex-direction:column; gap:8px; }
    .claim-actions button { font:inherit; font-weight:600; border-radius:8px; padding:10px 14px; cursor:pointer; border:1px solid transparent; }
    .claim-actions .approve { background:#15803d; color:#fff; }
    .claim-actions .reject { background:#fff; color:#b91c1c; border-color:#fecaca; }
    .claim-actions button:disabled { opacity:.5; cursor:default; }
    .claim-result { font-size:13px; }
    .claim-result .ok { color:#15803d; } .claim-result .bad { color:#b91c1c; }
    @media (max-width:700px) { .claim { grid-template-columns:1fr; } }`;
  document.head.appendChild(css);
})();
