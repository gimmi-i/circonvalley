const stripe = require("stripe")(process.env.STRIPE_SEKEY);

exports.handler = async (event) => {

  console.log("BODY RAW:", event.body);

  let body = {};

  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  const items = body.items || [];

  if (!items.length) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Cart is empty" }),
    };
  }
  
  try {
    const body = event.body ? JSON.parse(event.body) : {};

    const items = body.items || [];

    const line_items = items.map(item => ({
      price_data: {
        currency: "eur",
        product_data: {
          name: item.name,
          description:
            `Taglia: ${item.taglia || "-"}`
        },
        unit_amount: item.price * 100,
      },
      quantity: 1,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",

      line_items,

      success_url:
        "https://TUO-SITO.netlify.app/success",

      cancel_url:
        "https://circonvalley.netlify.app",

    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        url: session.url
      }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message
      }),
    };
  }
};
