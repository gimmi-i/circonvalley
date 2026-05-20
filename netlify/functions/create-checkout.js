const stripe = require("stripe")(process.env.STRIPE_SEKEY);

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body);

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
