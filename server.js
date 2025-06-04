const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
const allowedOrigins = [
  process.env.FRONTEND_URL,
  new RegExp('^https:\\/\\/[a-zA-Z0-9-]+\\.netlify\\.app$'),
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    const isAllowed = allowedOrigins.some(allowed =>
      typeof allowed === 'string' ? allowed === origin : allowed.test(origin)
    );
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed from this origin: ' + origin), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));


// Handle preflight requests
app.options('*', cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Package data
const packages = [
  {
    id: 1,
    name: "Essential Package",
    price: 69999,
    description: "Comprehensive Umrah package with essential services"
  },
  {
    id: 2,
    name: "Premium Package", 
    price: 79999,
    description: "Enhanced comfort with premium services"
  },
  {
    id: 3,
    name: "Luxury Package",
    price: 110000,
    description: "Ultimate luxury experience with business class travel"
  },
  {
    id: 999,
    name: "Free Umrah Application",
    price: 11,
    description: "Application for free Umrah opportunity"
  }
];

// Route to create Razorpay order
app.post('/api/create-order', async (req, res) => {
  try {
    const { packageId, customerInfo, paymentType } = req.body;
    
    // Find the package
    const selectedPackage = packages.find(pkg => pkg.id === packageId);
    if (!selectedPackage) {
      return res.status(404).json({ error: 'Package not found' });
    }

    // Calculate amount based on payment type
    let amount;
    if (paymentType === 'full') {
      amount = selectedPackage.price;
    } else if (paymentType === 'initial') {
      amount = 10000; // Initial payment amount
    } else {
      return res.status(400).json({ error: 'Invalid payment type' });
    }

    // Create Razorpay order
    const options = {
      amount: amount * 100, // Amount in paise (multiply by 100)
      currency: 'INR',
      receipt: `umrah_${packageId}_${Date.now()}`,
      notes: {
        package_name: selectedPackage.name,
        customer_name: customerInfo.name || 'Customer',
        customer_email: customerInfo.email || 'customer@example.com',
        customer_phone: customerInfo.phone || '9999999999',
        payment_type: paymentType
      },
    };

    const order = await razorpay.orders.create(options);
    
    res.json({
      success: true,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      package_name: selectedPackage.name,
    });

  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create order',
      message: error.message
    });
  }
});

// Route to verify payment
app.post('/api/verify-payment', (req, res) => {
  try {
    const { 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature,
      customerInfo,
      packageId 
    } = req.body;

    // Create signature for verification
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    // Verify signature
    if (expectedSignature === razorpay_signature) {
      // Payment is successful
      console.log('Payment verified successfully');
      
      // Here you can save the booking details to your database
      const bookingData = {
        order_id: razorpay_order_id,
        payment_id: razorpay_payment_id,
        package_id: packageId,
        customer_info: customerInfo,
        status: packageId === 999 ? 'application_received' : 'confirmed',
        created_at: new Date(),
      };
      
      // TODO: Save bookingData to your database
      console.log('Booking Data:', bookingData);
      
      res.json({
        success: true,
        message: 'Payment verified successfully',
        booking_id: razorpay_order_id,
        is_free_application: packageId === 999
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Payment verification failed'
      });
    }
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying payment',
      error: error.message
    });
  }
});

// Route to get package details
app.get('/api/packages', (req, res) => {
  res.json({ success: true, packages: packages.filter(pkg => pkg.id !== 999) });
});

// Route to get specific package
app.get('/api/packages/:id', (req, res) => {
  const packageId = parseInt(req.params.id);
  const package = packages.find(pkg => pkg.id === packageId);
  
  if (!package) {
    return res.status(404).json({ error: 'Package not found' });
  }
  
  res.json({ success: true, package });
});

// Route for UPI payment intent
app.post('/api/create-upi-intent', async (req, res) => {
  try {
    const { packageId, customerInfo, paymentType, upiId } = req.body;
    
    // Validate UPI ID format
    if (!upiId || !upiId.includes('@')) {
      return res.status(400).json({ error: 'Invalid UPI ID format' });
    }

    const selectedPackage = packages.find(pkg => pkg.id === packageId);
    if (!selectedPackage) {
      return res.status(404).json({ error: 'Package not found' });
    }

    let amount;
    if (paymentType === 'full') {
      amount = selectedPackage.price;
    } else if (paymentType === 'initial') {
      amount = 10000;
    } else {
      return res.status(400).json({ error: 'Invalid payment type' });
    }

    // Create a normal Razorpay order (UPI will be handled client-side)
    const options = {
      amount: amount * 100,
      currency: 'INR',
      receipt: `umrah_upi_${packageId}_${Date.now()}`,
      notes: {
        package_name: selectedPackage.name,
        customer_name: customerInfo.name || 'Customer',
        customer_email: customerInfo.email || 'customer@example.com',
        customer_phone: customerInfo.phone || '9999999999',
        payment_type: paymentType,
        upi_id: upiId,
        payment_method: 'upi'
      },
    };

    const order = await razorpay.orders.create(options);
    
    res.json({
      success: true,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      package_name: selectedPackage.name,
      upi_id: upiId,
      deep_link: `upi://pay?pa=${upiId}&pn=UmrahTours&am=${amount}&cu=INR&tn=UmrahPackagePayment`
    });

  } catch (error) {
    console.error('Error creating UPI intent:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create UPI payment',
      message: error.message
    });
  }
});

// Route for payment failure handling
app.post('/api/payment-failed', (req, res) => {
  try {
    const { order_id, payment_id, error } = req.body;
    
    console.log('Payment failed:', { order_id, payment_id, error });
    
    // TODO: Log the failed payment and update booking status
    
    res.json({
      success: true,
      message: 'Payment failure recorded'
    });
  } catch (error) {
    console.error('Error handling payment failure:', error);
    res.status(500).json({
      success: false,
      message: 'Error recording payment failure'
    });
  }
});

// Health check route
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running', timestamp: new Date() });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});