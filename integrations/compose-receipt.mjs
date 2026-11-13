export async function withComposeLifecycle(mutation, tracker) {
  const response = await mutation;
  if (response?.isError || response?.content?.length !== 1 || response.content[0]?.type !== 'text') return response;
  try {
    const receipt = JSON.parse(response.content[0].text);
    if (!['accepted', 'pending'].includes(receipt.status) || typeof receipt.requestId !== 'string' ||
        !receipt.requestId.length || receipt.requestId.length > 128) return response;
    const observed = await tracker.wait({ requestId: receipt.requestId }, 800);
    const matches = observed?.requestId === receipt.requestId && observed.receipt &&
      ['session', 'epoch', 'seq'].every(key => observed.receipt[key] === receipt[key]);
    const lifecycle = matches ? observed : { requestId: receipt.requestId, status: 'unknown',
      reason: 'receipt_identity_unverified', visibility: 'unknown' };
    return { ...response, content: [{ ...response.content[0], text: JSON.stringify({ ...receipt, lifecycle }) }] };
  } catch { return response; }
}
