// POS applies these strings to the current cart or line. A resolved API call on
// older POS versions can precede its cart signal, so compare the actual values.
export function hasProperties(current, expected) {
  return current != null && Object.entries(expected).every(([key, value]) => current[key] === value);
}

export async function writeOrderMarkers(cart, orderProperties, noteProperties) {
  const groups = [orderProperties, noteProperties].filter(group => Object.keys(group).length);
  if (!groups.length || typeof cart.addCartProperties !== 'function') return;
  if (groups.length > 1) {
    try {
      await cart.addCartProperties({...orderProperties, ...noteProperties});
    } catch (error) {
      console.warn('[MSH Marker] Combined cart property write failed.', error?.message);
    }
  }
  // Preserve the independent fallback paths when a host rejects the combined
  // payload, reports partial metadata or has not published its updated cart.
  for (const group of groups) {
    if (hasProperties(cart.current?.value?.properties, group)) continue;
    try {
      await cart.addCartProperties(group);
    } catch (error) {
      console.warn('[MSH Marker] Cart property fallback failed.', error?.message);
    }
  }
}

// Wait only when this device's cart signal has not yet caught up with the write.
export async function confirmCartState(signal, predicate, timeout = 1500) {
  if (predicate(signal?.value)) return true;
  if (!signal || typeof signal.subscribe !== 'function') return false;
  let timer, unsubscribe;
  try {
    return await new Promise(resolve => {
      timer = setTimeout(() => resolve(predicate(signal.value)), timeout);
      unsubscribe = signal.subscribe(state => {
        if (predicate(state)) resolve(true);
      });
      if (predicate(signal.value)) resolve(true);
    });
  } finally {
    clearTimeout(timer);
    if (typeof unsubscribe === 'function') unsubscribe();
  }
}
