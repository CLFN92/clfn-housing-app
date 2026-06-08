/* ============================================================
 * finance-calculator.js — Loan & Payment Calculator
 *
 * Pure amortization math + the loan calculator form's UI handlers.
 * Zero data-layer dependencies — calcPaymentAmt / calcLoanTermFromPayment
 * only do arithmetic. The UI handlers (calcLoan, onLoan*) read DOM
 * elements and call fmt() from finance-utils.js.
 * ============================================================ */

// ── Loan Math ────────────────────────────────────────────────────────────────
// Payments per year for each frequency
var FREQ_PY = { monthly:12, semimonthly:24, biweekly:26, weekly:52 };

// Compound interest payment: PMT = P * r / (1 - (1+r)^-n)
// where r = periodic rate, n = number of periods
function calcPaymentAmt(principal, annualRate, termMonths, freq) {
  if (freq === 'adhoc' || annualRate === -1) return 0; // non-accrual
  freq = freq || 'monthly';
  var ppy  = FREQ_PY[freq] || 12;
  var n    = Math.round(termMonths * ppy / 12); // total periods
  var r    = annualRate / 100 / ppy;            // periodic rate
  if (principal <= 0 || n <= 0) return 0;
  if (r === 0) return Math.round(principal / n * 100) / 100;
  // Standard amortization formula
  var pmt = principal * r / (1 - Math.pow(1 + r, -n));
  return Math.round(pmt * 100) / 100;
}

// Solve for n periods given payment: n = -ln(1 - Pr/PMT) / ln(1+r)
function calcLoanTermFromPayment(principal, annualRate, payment, freq) {
  freq = freq || 'monthly';
  var ppy = FREQ_PY[freq] || 12;
  var r   = annualRate / 100 / ppy;
  if (principal <= 0 || payment <= 0) return 0;
  if (r === 0) return Math.ceil(principal / payment);
  if (payment <= principal * r) return 0; // payment too low to cover interest
  var periods = -Math.log(1 - (principal * r) / payment) / Math.log(1 + r);
  // Convert periods back to months
  return Math.ceil(periods / ppy * 12);
}

// Total periods for a given term in months and frequency
function termToPeriods(termMonths, freq) {
  var ppy = FREQ_PY[freq] || 12;
  return Math.round(termMonths * ppy / 12);
}

function fmtTermLabel(months) {
  if (!months || months <= 0) return '';
  var yrs = Math.floor(months / 12);
  var mos = months % 12;
  var parts = [];
  if (yrs > 0) parts.push(yrs  + (yrs  === 1 ? ' year'  : ' years'));
  if (mos > 0) parts.push(mos  + (mos  === 1 ? ' month' : ' months'));
  return parts.join(' and ');
}

function onLoanFreqChange() {
  var freq = (document.getElementById('ln-freq')||{}).value || 'monthly';
  var labels = {monthly:'Monthly', semimonthly:'Semi-Monthly', biweekly:'Bi-Weekly', weekly:'Weekly'};
  var lbl = document.getElementById('ln-payment-label');
  if (lbl) lbl.textContent = (labels[freq]||'') + ' Payment ($)';
  calcLoan();
}


function onLoanTermInput() {
  var termEl  = document.getElementById('ln-term');
  var payEl   = document.getElementById('ln-payment');
  var termLbl = document.getElementById('ln-term-lbl');
  var payLbl  = document.getElementById('ln-payment-lbl');
  var term    = parseInt(termEl.value) || 0;
  if (term > 0) {
    if (termLbl) termLbl.textContent = fmtTermLabel(term);
    if (payEl)  { payEl.value = ''; payEl.placeholder = 'Calculating…'; }
    if (payLbl) payLbl.textContent = '';
  } else {
    if (termLbl) termLbl.textContent = '';
  }
  calcLoan();
}

function onLoanPaymentInput() {
  var termEl  = document.getElementById('ln-term');
  var payEl   = document.getElementById('ln-payment');
  var termLbl = document.getElementById('ln-term-lbl');
  var payment = parseFloat(payEl.value) || 0;
  if (payment > 0) {
    if (termEl) { termEl.value = ''; termEl.placeholder = 'Calculating…'; }
    if (termLbl) termLbl.textContent = '';
  }
  calcLoan();
}


function calcLoan() {
  var principal = parseFloat(document.getElementById('ln-principal').value) || 0;
  var rateType  = document.getElementById('ln-rate-type').value;
  var loanTypeVal = (document.getElementById('ln-type')||{}).value||'';
  var isNonAccrual = loanTypeVal === 'non-accrual';
  var rate      = (rateType === 'none' || isNonAccrual) ? 0 : (parseFloat(document.getElementById('ln-rate').value) || 0);
  var freq      = document.getElementById('ln-freq').value;
  var el        = document.getElementById('loanCalcResult');
  var termEl    = document.getElementById('ln-term');
  var payEl     = document.getElementById('ln-payment');
  var termLbl   = document.getElementById('ln-term-lbl');
  var payLbl    = document.getElementById('ln-payment-lbl');

  // Lock rate field if interest-free
  var rateInput = document.getElementById('ln-rate');
  if (rateInput) {
    if (rateType === 'none') {
      rateInput.value    = '';
      rateInput.disabled = true;
      rateInput.placeholder = 'N/A — Interest-Free';
      rateInput.style.background = 'var(--bg)';
      rateInput.style.color      = 'var(--muted)';
    } else {
      rateInput.disabled = false;
      rateInput.placeholder = '0.00';
      rateInput.style.background = '';
      rateInput.style.color      = '';
    }
  }

  if (!principal) { el.style.display = 'none'; return; }

  var term    = parseInt(termEl.value)      || 0;
  var payment = parseFloat(payEl.value)     || 0;
  var finalTerm, finalPayment, periods;

  // Update payment label to match frequency
  var freqLabels = {monthly:'Monthly', semimonthly:'Semi-Monthly', biweekly:'Bi-Weekly', weekly:'Weekly'};

  if (term > 0) {
    // Term entered — calculate payment
    finalTerm    = term;
    periods      = termToPeriods(finalTerm, freq);
    finalPayment = calcPaymentAmt(principal, rate, finalTerm, freq);
    // Always update payment field when term drives the calculation
    payEl.value       = finalPayment.toFixed(2);
    payEl.placeholder = 'e.g. 250.00';
    if (termLbl) { termLbl.textContent = fmtTermLabel(term); termLbl.style.color = 'var(--muted)'; }
    if (payLbl)  payLbl.textContent = 'Calculated from ' + fmtTermLabel(term) + ' term';

  } else if (payment > 0) {
    // Payment entered — calculate term
    finalTerm = calcLoanTermFromPayment(principal, rate, payment, freq);
    if (!finalTerm || finalTerm <= 0) {
      el.style.display = 'none';
      if (termLbl) { termLbl.textContent = '⚠ Payment too low to cover interest'; termLbl.style.color = 'var(--danger)'; }
      return;
    }
    finalPayment  = payment;
    periods       = termToPeriods(finalTerm, freq);
    termEl.value  = finalTerm;
    if (termLbl) { termLbl.textContent = fmtTermLabel(finalTerm); termLbl.style.color = 'var(--muted)'; }
    if (payLbl)  payLbl.textContent = (freqLabels[freq]||'') + ' payment · term calculated';

  } else {
    el.style.display = 'none';
    return;
  }

  // Totals
  var totalRepay    = Math.round(finalPayment * periods * 100) / 100;
  var totalInterest = Math.max(0, Math.round((totalRepay - principal) * 100) / 100);
  var freqLbl       = {monthly:'per month', semimonthly:'semi-monthly', biweekly:'bi-weekly', weekly:'per week'}[freq] || 'per period';

  el.style.display = 'block';

  document.getElementById('cr-payment').textContent  = fmt(finalPayment);
  document.getElementById('cr-freq-lbl').textContent = freqLbl;
  document.getElementById('cr-total').textContent    = fmt(totalRepay);
  document.getElementById('cr-term-lbl').textContent = 'over ' + fmtTermLabel(finalTerm) + ' (' + finalTerm + ' months / ' + periods + ' payments)';

  var cobRows = [
    {label:'Principal',               val:principal,     color:'#fff'},
    {label:'Total Interest',          val:totalInterest, color:totalInterest > 0 ? '#f87171' : '#4ade80'},
    {label:'Total Cost of Borrowing', val:totalRepay,    color:'var(--yellow)', bold:true},
    {label:'Annual Rate (APR)',        val:(rateType==='none' ? '0% (Interest-Free)' : rate.toFixed(2)+'%'), isText:true, color:'var(--gray)'},
  ];
  document.getElementById('cr-cob-rows').innerHTML = cobRows.map(function(row){
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--dark3);">' +
      '<span style="font-size:12px;color:#aaa;">' + (row.bold ? '<strong>' + row.label + '</strong>' : row.label) + '</span>' +
      '<span style="font-size:' + (row.bold?'15':'13') + 'px;font-weight:' + (row.bold?'700':'500') + ';color:' + row.color + ';">' +
        (row.isText ? row.val : fmt(row.val)) +
      '</span></div>';
  }).join('');
}
