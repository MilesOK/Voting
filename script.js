const PRICE_PER_VOTE = 100;

const form = document.getElementById('ballotForm');
const voteCountEl = document.getElementById('voteCount');
const totalDisplay = document.getElementById('totalDisplay');
const decBtn = document.getElementById('decBtn');
const incBtn = document.getElementById('incBtn');
const payBtn = document.getElementById('payBtn');
const formError = document.getElementById('formError');
const successBlock = document.getElementById('successBlock');
const refDisplay = document.getElementById('refDisplay');

function formatNaira(n){
  return '\u20a6' + n.toLocaleString('en-NG');
}

function currentVotes(){
  return parseInt(voteCountEl.value, 10) || 1;
}

function selectedCategoryCount(){
  return Object.values(getCategorySelections()).filter(Boolean).length;
}

function updateTotal(){
  const total = selectedCategoryCount() * currentVotes() * PRICE_PER_VOTE;
  totalDisplay.textContent = formatNaira(total);
}

function getCategorySelections(){
  const categories = [...form.querySelectorAll('.category')];

  return categories.reduce((picked, category) => {
    const firstOption = category.querySelector('input[type=radio]');
    if (!firstOption) return picked;

    picked[firstOption.name] = form.querySelector(`input[name="${firstOption.name}"]:checked`);
    return picked;
  }, {});
}

async function readApiResponse(response) {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    if (response.status === 404) {
      throw new Error('Payment service is unavailable. Please contact the organiser or try again later.');
    }
    throw new Error('Payment service returned an invalid response. Please try again later.');
  }
}

decBtn.addEventListener('click', () => {
  const v = Math.max(1, currentVotes() - 1);
  voteCountEl.value = v;
  updateTotal();
});

incBtn.addEventListener('click', () => {
  const v = Math.min(999, currentVotes() + 1);
  voteCountEl.value = v;
  updateTotal();
});

document.querySelectorAll('.nominee input[type=radio]').forEach(radio => {
  radio.addEventListener('change', () => {
    const group = document.getElementsByName(radio.name);
    group.forEach(r => r.closest('.nominee').classList.toggle('checked', r.checked));
    updateTotal();
  });
});

async function showPaymentResult() {
  const reference = new URLSearchParams(window.location.search).get('reference');
  if (!reference) return;

  payBtn.disabled = true;
  payBtn.textContent = 'Confirming payment...';
  try {
    const response = await fetch(`/api/payments/${encodeURIComponent(reference)}`);
    const result = await readApiResponse(response);
    if (!response.ok || result.status !== 'paid') throw new Error(result.message || 'Payment is still being confirmed.');
    form.style.display = 'none';
    successBlock.style.display = 'block';
    refDisplay.textContent = `Ref: ${reference}`;
    window.history.replaceState({}, document.title, window.location.pathname);
  } catch (error) {
    formError.textContent = error.message || 'We could not confirm your payment yet. Please refresh shortly.';
    formError.style.display = 'block';
    payBtn.disabled = false;
    payBtn.textContent = 'Pay & submit vote';
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.style.display = 'none';

  const voterName = document.getElementById('voterName').value.trim();
  const voterEmail = document.getElementById('voterEmail').value.trim();
  const selections = getCategorySelections();
  const selectedEntries = Object.entries(selections).filter(([, selection]) => selection);
  const categoryCount = selectedEntries.length;

  if (!voterName || !voterEmail || categoryCount === 0) {
    formError.style.display = 'block';
    return;
  }

  const votes = currentVotes();
  const voteData = {
    voterName,
    voterEmail,
    votes,
    ...Object.fromEntries(
      selectedEntries.map(([categoryName, selection]) => [categoryName, selection.value])
    )
  };

  payBtn.disabled = true;
  payBtn.textContent = 'Preparing payment...';

  try {
    const response = await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...voteData, selections: Object.fromEntries(selectedEntries.map(([key, selection]) => [key, selection.value])) })
    });
    const result = await readApiResponse(response);
    if (!response.ok) throw new Error(result.message || 'Unable to start payment.');
    window.location.assign(result.authorizationUrl);
  } catch (error) {
    formError.textContent = error.message || 'Unable to start payment. Please refresh and try again.';
    formError.style.display = 'block';
    payBtn.disabled = false;
    payBtn.textContent = 'Pay & submit vote';
    console.error(error);
  }
});

updateTotal();
showPaymentResult();
