require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16'
});
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.get('/config', (req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_TYooMQauvdEDq54NiTphI7jx'
  });
});

app.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount, type, name, email } = req.body;
    let clientSecret;
    let paymentIntentId;
    let customerId = null;
    
    // Create or find a customer
    const customerData = {};
    if (name) customerData.name = name;
    if (email) customerData.email = email;
    
    // Always create a customer to track donations easily in the dashboard
    const customer = await stripe.customers.create(customerData);
    customerId = customer.id;

    if (type === 'monthly') {
        // Stripe subscriptions require an existing product ID in price_data, 
        // unlike Checkout which allows inline product_data.
        let products = await stripe.products.list({ limit: 100, active: true });
        let product = products.data.find(p => p.name === 'Monthly Donation');
        if (!product) {
            product = await stripe.products.create({
                name: 'Monthly Donation',
            });
        }
        
        // Create the subscription using inline dynamic pricing (price_data)
        const subscription = await stripe.subscriptions.create({
            customer: customer.id,
            items: [{
                price_data: {
                    currency: 'usd',
                    product: product.id,
                    unit_amount: Math.round(amount * 100),
                    recurring: {
                        interval: 'month'
                    }
                }
            }],
            payment_behavior: 'default_incomplete',
            payment_settings: { 
                payment_method_types: ['card', 'link'],
                save_default_payment_method: 'on_subscription' 
            },
            expand: ['latest_invoice.payment_intent'],
        });
        
        // Robust fetch: If expand failed (account setting), retrieve the invoice manually.
        let invoice = subscription.latest_invoice;
        if (typeof invoice === 'string') {
            invoice = await stripe.invoices.retrieve(invoice, { expand: ['payment_intent'] });
        }

        if (!invoice || !invoice.payment_intent) {
            throw new Error(`Invoice missing payment intent. Subscription Status: ${subscription.status}`);
        }
        
        clientSecret = invoice.payment_intent.client_secret;
        paymentIntentId = invoice.payment_intent.id;
    } else {
        // Create a definitive PaymentIntent for one-time donations
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount * 100),
          currency: 'usd',
          customer: customer.id,
          receipt_email: email || undefined,
          payment_method_types: ['link', 'crypto'],
        });
        
        clientSecret = paymentIntent.client_secret;
        paymentIntentId = paymentIntent.id;
    }

    res.json({ clientSecret, paymentIntentId, customerId });
  } catch (error) {
    console.error('Error creating payment intent:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/update-payment-info', async (req, res) => {
  try {
    const { customerId, paymentIntentId, name, email } = req.body;
    
    if (customerId) {
        await stripe.customers.update(customerId, {
            name: name || undefined,
            email: email || undefined
        });
    }

    if (paymentIntentId && email) {
        await stripe.paymentIntents.update(paymentIntentId, {
            receipt_email: email
        });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating payment info:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
