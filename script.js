/* ============================================================
   CONFIG - edit these before you publish the page
   ============================================================ */
const CONFIG = {
  PAYSTACK_PAYMENT_LINK: "https://paystack.shop/pay/xwvtursgu-",

  PRICE_PER_VOTE: 100, // in Naira
  CURRENCY: "NGN",

  // Optional: wire this page up to a Google Form so every paid vote is
  // logged as a row in the Form's response spreadsheet.
  //   1. Create a Google Form with a short-answer question for name and
  //      email, plus one multiple-choice question per category, using the
  //      exact same option text as the "value" attributes above.
  //   2. In the Form editor, click the menu -> "Get pre-filled link",
  //      fill in dummy answers, click "Get link", then open that link and
  //      copy each "entry.XXXXXXXXX" number from the URL.
  //   3. Paste the form ID and entry IDs below. Leave GOOGLE_FORM_ID blank
  //      to skip this step (payment will still work, it just won't log
  //      anywhere).
  GOOGLE_FORM_ID: "", // the long id from your form's edit URL
  ENTRY_IDS: {
    voterName: "",   // e.g. "entry.111111111"
    voterEmail: "",  // e.g. "entry.222222222"
    cat1: "",        // e.g. "entry.333333333"
    cat2: "",
    cat3: "",
    cat4: "",
    cat5: "",
    cat6: ""
  }
};
/* ============================================================ */

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

function updateTotal(){
  const total = currentVotes() * CONFIG.PRICE_PER_VOTE;
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
  });
});

function submitToGoogleForm(data){
  if (!CONFIG.GOOGLE_FORM_ID) return;

  const url = `https://docs.google.com/forms/d/e/${CONFIG.GOOGLE_FORM_ID}/formResponse`;
  const body = new URLSearchParams();

  Object.entries(CONFIG.ENTRY_IDS).forEach(([field, entryId]) => {
    if (entryId && data[field] !== undefined) {
      body.append(entryId, data[field]);
    }
  });

  fetch(url, { method: 'POST', mode: 'no-cors', body });
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  formError.style.display = 'none';

  const voterName = document.getElementById('voterName').value.trim();
  const voterEmail = document.getElementById('voterEmail').value.trim();
  const selections = getCategorySelections();

  if (!voterName || !voterEmail || Object.values(selections).some(selection => !selection)) {
    formError.style.display = 'block';
    return;
  }

  const votes = currentVotes();
  const voteData = {
    voterName,
    voterEmail,
    votes,
    ...Object.fromEntries(
      Object.entries(selections).map(([categoryName, selection]) => [categoryName, selection.value])
    )
  };

  payBtn.disabled = true;
  payBtn.textContent = 'Opening Paystack...';

  submitToGoogleForm(voteData);
  window.location.href = CONFIG.PAYSTACK_PAYMENT_LINK;
});

updateTotal();
