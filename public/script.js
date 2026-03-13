// Initialize Stripe conditionally on load
let stripe;
let elements;

// Fetch publishable key before initializing Stripe
async function initializeStripe() {
    try {
        const response = await fetch('/config');
        const { publishableKey } = await response.json();
        stripe = Stripe(publishableKey);
    } catch (error) {
        console.error("Error fetching stripe config", error);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    // Wait for Stripe initialization
    await initializeStripe();

    // State
    let currentType = 'one-time';
    let currentAmount = 10;
    let isCustomAmount = false;
    let isPaymentElementReady = false;
    
    // Stripe Context State
    let currentCustomerId = null;
    let currentPaymentIntentId = null;
    let donorName = '';
    let donorEmail = '';

    // DOM Elements
    const toggleBtns = document.querySelectorAll('.toggle-btn');
    const amountBtns = document.querySelectorAll('.amount-btn');
    const customAmountInput = document.getElementById('custom-amount');
    const displayAmount = document.getElementById('display-amount');
    const donateSubmitBtn = document.getElementById('donate-submit-btn');
    const statusMessage = document.getElementById('status-message');
    const paymentForm = document.getElementById('payment-form');
    const paymentElementContainer = document.getElementById('payment-element');
    
    const expressCheckoutContainer = document.getElementById('express-checkout-element');
    const expressCheckoutDivider = document.getElementById('express-checkout-divider');
    const linkAuthenticationContainer = document.getElementById('link-authentication-element');
    const addressContainer = document.getElementById('address-element');

    // Initialize UI
    updateSubmitButton();
    checkUrlStatus();
    initializeStripeElements(); // Auto-load default $10 element

    // Toggle One-Time / Monthly
    toggleBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            toggleBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentType = e.target.dataset.type;
            
            // Re-initialize Elements when subscription type changes
            initializeStripeElements();
        });
    });

    // Select Amount
    amountBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Remove active class from all buttons and clear custom input
            amountBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            customAmountInput.value = '';
            isCustomAmount = false;
            
            currentAmount = parseInt(e.target.dataset.amount);
            updateSubmitButton();
            initializeStripeElements(); // Re-initialize with new amount
        });
    });

    // Custom Amount Input
    // Use debounce for custom input to avoid making too many API calls while typing
    let typingTimer;
    customAmountInput.addEventListener('input', (e) => {
        clearTimeout(typingTimer);
        const val = e.target.value;
        amountBtns.forEach(b => b.classList.remove('active'));
        
        if (val && !isNaN(val) && parseInt(val) > 0) {
            isCustomAmount = true;
            currentAmount = parseInt(val);
        } else {
            // Fallback if empty or invalid
            currentAmount = 0;
        }
        updateSubmitButton();

        typingTimer = setTimeout(() => {
            if (currentAmount > 0) {
                initializeStripeElements();
            }
        }, 800);
    });

    function updateSubmitButton() {
        if (currentAmount > 0) {
            displayAmount.textContent = `$${currentAmount}`;
            // Cannot submit until Element is also ready, unless we hide it?
            // Rely on isPaymentElementReady as well
        } else {
            displayAmount.textContent = '';
            setSubmitState('disabled');
        }
    }

    // Initialize the Stripe Payment Element
    async function initializeStripeElements() {
        if (!stripe || currentAmount <= 0) {
            paymentElementContainer.classList.add('hidden');
            return;
        }

        setSubmitState('loading');
        
        try {
            // Premium Stripe Appearance options to match our darker CSS theme
            // colorBackground must be hex, rgb or hsl
            const appearance = {
                theme: 'night',
                variables: {
                    fontFamily: 'Montserrat, sans-serif',
                    fontLineHeight: '1.5',
                    borderRadius: '12px',
                    colorBackground: '#1e293b', 
                    colorText: '#f8fafc',
                    colorPrimary: '#6366f1',
                    colorDanger: '#ef4444',
                    spacingUnit: '4px',
                },
                rules: {
                    '.Input': {
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        boxShadow: 'none',
                    },
                    '.Input:focus': {
                        borderColor: '#6366f1',
                        borderWidth: '1px'
                    }
                }
            };

            // Use Deferred Intent Creation setup
            const elementsOptions = {
                mode: currentType === 'monthly' ? 'subscription' : 'payment',
                amount: Math.round(currentAmount * 100),
                currency: 'usd',
                appearance: appearance,
                paymentMethodTypes: ['link', 'crypto'], // Restringir los metodos permitidos frontend
            };
            
            // For monthly, we don't pass an amount in the same way because subscription amounts are defined on the price,
            // but Stripe Elements deferred intent still requires an amount to display correctly if there are UI components
            // that rely on it. If type === 'monthly', we need 'subscription' mode.

            elements = stripe.elements(elementsOptions);
            
            // 1. Express Checkout Element (Apple Pay / Google Pay)
            const expressCheckoutOptions = {
                buttonType: {
                    applePay: 'donate',
                    googlePay: 'donate',
                    paypal: 'paypal'
                }
            };
            const expressCheckoutElement = elements.create('expressCheckout', expressCheckoutOptions);
            
            expressCheckoutContainer.innerHTML = '';
            expressCheckoutElement.mount('#express-checkout-element');
            
            expressCheckoutElement.on('ready', ({availablePaymentMethods}) => {
                if (availablePaymentMethods) {
                    expressCheckoutContainer.classList.remove('hidden');
                    expressCheckoutDivider.classList.remove('hidden');
                } else {
                    expressCheckoutContainer.classList.add('hidden');
                    expressCheckoutDivider.classList.add('hidden');
                }
            });

            // 2. Link Authentication Element (Email)
            const linkAuthenticationElement = elements.create('linkAuthentication');
            linkAuthenticationContainer.innerHTML = '';
            linkAuthenticationElement.mount('#link-authentication-element');
            linkAuthenticationContainer.classList.remove('hidden');
            
            linkAuthenticationElement.on('change', (event) => {
                if (event.value && event.value.email) {
                    donorEmail = event.value.email;
                }
            });

            // 3. Address Element (Name & Address)
            const addressOptions = {
                mode: 'billing',
            };
            const addressElement = elements.create('address', addressOptions);
            addressContainer.innerHTML = '';
            addressElement.mount('#address-element');
            addressContainer.classList.remove('hidden');
            
            addressElement.on('change', (event) => {
                if (event.value && event.value.name) {
                    donorName = event.value.name;
                }
            });

            // 4. Payment Element (Card, etc.)
            const paymentElementOptions = { layout: 'tabs' };
            const paymentElement = elements.create('payment', paymentElementOptions);
            
            // Only reveal after it loads completely to prevent flash of empty div
            paymentElementContainer.innerHTML = ''; 
            paymentElement.mount('#payment-element');

            paymentElement.on('ready', () => {
                isPaymentElementReady = true;
                paymentElementContainer.classList.remove('hidden');
                setSubmitState('ready');
            });

        } catch (error) {
            console.error('Failed to init Elements:', error);
            showStatus('error', 'Error connecting to secured payment service.');
            setSubmitState('disabled');
        }
    }

    // Form Submission
    paymentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!stripe || !elements || !isPaymentElementReady) return;

        setSubmitState('loading');
        
        try {
            // 1. Create the PaymentIntent or Subscription now that the user hit submit
            const response = await fetch('/create-payment-intent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    amount: currentAmount, 
                    type: currentType,
                    name: donorName,
                    email: donorEmail
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to initialize payment');
            }

            const { clientSecret } = await response.json();

            // 2. Confirm the payment using the newly generated client secret
            const { error } = await stripe.confirmPayment({
                elements,
                clientSecret, // Pass the secret we just generated
                confirmParams: {
                    // Determine the success URL locally
                    return_url: `${window.location.origin}/success.html`,
                },
            });

            // This point will only be reached if there is an immediate error during processing.
            if (error) {
                const messageContainer = document.querySelector('#payment-message');
                messageContainer.textContent = error.message;
                messageContainer.classList.remove('hidden');
                
                setTimeout(() => {
                    messageContainer.classList.add('hidden');
                }, 6000);
                
                setSubmitState('ready');
            }

        } catch (err) {
            console.error('Payment submission failed:', err);
            const messageContainer = document.querySelector('#payment-message');
            messageContainer.textContent = err.message || "An unexpected error occurred.";
            messageContainer.classList.remove('hidden');
            setSubmitState('ready');
        }
    });

    // Helper functions
    function setSubmitState(state) {
        if (state === 'loading') {
            donateSubmitBtn.classList.add('loading');
            donateSubmitBtn.disabled = true;
        } else if (state === 'ready') {
            donateSubmitBtn.classList.remove('loading');
            donateSubmitBtn.disabled = false;
            donateSubmitBtn.style.opacity = '1';
            donateSubmitBtn.style.cursor = 'pointer';
        } else if (state === 'disabled') {
            donateSubmitBtn.classList.remove('loading');
            donateSubmitBtn.disabled = true;
            donateSubmitBtn.style.opacity = '0.5';
            donateSubmitBtn.style.cursor = 'not-allowed';
        }
    }

    function checkUrlStatus() {
        const urlParams = new URLSearchParams(window.location.search);
        // Fallback for Checkout Session logic if still using the old URL style sometimes
        if (urlParams.get('payment_intent_client_secret')) {
             const redirectStatus = urlParams.get('redirect_status');
             if (redirectStatus === 'succeeded') {
                 // Technically this logic goes onto success.html, but keep for robustness on index.html
                 showStatus('success', 'Thank you for your generous donation!');
             } else if (redirectStatus === 'failed') {
                 showStatus('error', 'Payment failed or was canceled. Please try again.');
             }
             window.history.replaceState(null, '', window.location.pathname);
        }
    }

    function showStatus(type, text) {
        statusMessage.textContent = text;
        statusMessage.className = `status-message ${type}`;
        setTimeout(() => { statusMessage.classList.add('hidden'); }, 5000);
    }
});
