export const action = async ({ request }) => {
  console.log('[MSH-PING] ROUTE HIT method=' + request.method);
  return Response.json(
    { ok: true, pong: true },
    {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    }
  );
};

export const loader = async ({ request }) => {
  console.log('[MSH-PING] LOADER HIT method=' + request.method);
  return Response.json(
    { ok: true, pong: true },
    {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
};
