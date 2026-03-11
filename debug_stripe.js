require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function run() {
    try {
        const customer = await stripe.customers.create();
        let products = await stripe.products.list({ limit: 1 });
        let product = products.data[0];
        
        const subscription = await stripe.subscriptions.create({
            customer: customer.id,
            items: [{
                price_data: {
                    currency: 'usd',
                    product: product.id,
                    unit_amount: 1000,
                    recurring: { interval: 'month' }
                }
            }],
            payment_behavior: 'default_incomplete',
            payment_settings: { save_default_payment_method: 'on_subscription' },
        });
        
        let invoiceId = typeof subscription.latest_invoice === 'string' ? subscription.latest_invoice : subscription.latest_invoice.id;
        let invoice = await stripe.invoices.retrieve(invoiceId, { expand: ['payment_intent'] });
        
        console.log(JSON.stringify(invoice, null, 2));
    } catch(e) {
        console.error("Error:", e);
    }
}
run();
