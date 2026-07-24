require('dotenv').config({ path: '../.env.local' });

// Bypass SSL errors
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function main() {
  const loginUrl = `${process.env.ACUMATICA_BASE_URL}/entity/auth/login`;
  
  const loginRes = await fetch(loginUrl, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: process.env.ACUMATICA_USERNAME,
      password: process.env.ACUMATICA_PASSWORD,
      company: process.env.ACUMATICA_COMPANY
    })
  });

  if (!loginRes.ok) {
    console.error('Login failed:', loginRes.status);
    return;
  }

  const cookie = loginRes.headers.getSetCookie().join('; ');

  const url = `${process.env.ACUMATICA_BASE_URL}/entity/Default/20.200.001/PurchaseOrder?$expand=Details&$top=1`;
  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Cookie': cookie
      }
    });
    if (res.ok) {
      const data = await res.json();
      const orders = data.value || data;
      if (Array.isArray(orders) && orders.length > 0) {
        const order = orders[0];
        console.log('Order keys:', Object.keys(order));
        
        let details = order.Details || [];
        if (details.value) details = details.value;
        if (Array.isArray(details) && details.length > 0) {
          console.log('Line keys:', Object.keys(details[0]));
          console.log('Line sample:', JSON.stringify(details[0], null, 2));
        } else {
          console.log('No details array found.');
        }
      }
    } else {
      console.log('Failed:', await res.text());
    }
  } catch (e) {
    console.error('Fetch error:', e);
  }

  // Logout
  await fetch(`${process.env.ACUMATICA_BASE_URL}/entity/auth/logout`, {
    method: 'POST',
    headers: { 'Cookie': cookie }
  });
}

main();
