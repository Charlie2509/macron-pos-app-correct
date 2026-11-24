import test from 'node:test';
import assert from 'node:assert/strict';
import {findFeeVariant, feeProductTitle, feeProductHandle} from '../extensions/macron-pos/src/fee-variant.js';

function variant(value, overrides = {}) {
  return {id:'gid://shopify/ProductVariant/'+value.replace('.',''), title:value, price:value,
    selectedOptions:[{value}],availableForSale:true,...overrides};
}
function batch(nodes, next = null) {
  return {shop:{currencyCode:'GBP'},product:{id:'fee',handle:feeProductHandle,title:feeProductTitle,
    variants:{nodes,pageInfo:{hasNextPage:next !== null,endCursor:next}}}};
}

test('reads only the first page for an exact, saleable GBP fee variant', async () => {
  let reads = 0;
  const fee = variant('2.50');
  const result = await findFeeVariant(2.5, async (_,vars) => {
    reads++;
    assert.deepEqual(vars,{handle:feeProductHandle,after:null});
    return batch([fee],'more');
  });
  assert.equal(reads,1);
  assert.equal(result.match.id,fee.id);
  assert.equal(result.match.method,'exact_title');
});

test('finds the verified variant on a subsequent page, including alternate amount labels', async () => {
  const first = Array.from({length:100},(_,index)=>variant((index / 10).toFixed(2)));
  const found = variant('15.00',{title:'£15',selectedOptions:[]});
  const pages = [batch(first,'next'),batch([found])];
  const cursors = [];
  const result = await findFeeVariant(15,async (_,vars) => {
    cursors.push(vars.after); return pages.shift();
  });
  assert.deepEqual(cursors,[null,'next']);
  assert.equal(result.scanned,101);
  assert.deepEqual(result.match,{id:found.id,text:'£15',method:'numeric_text'});
});

test('refuses mismatched amounts, currency, wrong products, invalid fee precision or unavailable fees', async () => {
  for (const [amount,data] of [
    [2.5,batch([variant('2.50',{price:'2.40'})])],
    [2.5,batch([variant('2.50',{price:'2.505'})])],
    [2.5,batch([variant('2.50',{availableForSale:false})])],
    [2.5,{...batch([variant('2.50')]),shop:{currencyCode:'EUR'}}],
    [2.5,{...batch([]),product:{...batch([]).product,handle:'other'}}],
    [2.505,batch([variant('2.50')])],
  ]) await assert.rejects(findFeeVariant(amount,async()=>data));
});

test('incomplete fees, repeated cursors and a different product mid-read cannot result in a cart charge', async () => {
  await assert.rejects(findFeeVariant(15,async()=>batch([],'same-cursor')), /invalid catalogue cursor/);
  await assert.rejects(findFeeVariant(15,async(_,vars)=>vars.after ? Promise.reject(new Error('Network error')) : batch([],'a')), /Network error/);
  await assert.rejects(findFeeVariant(15,async(_,vars)=>{
    const result=batch(vars.after ? [variant('15.00')] : [],vars.after ? null : 'a');
    if (vars.after) result.product.id='other';
    return result;
  }),/could not be verified/);
  const data=batch([variant('15.00')]); delete data.product.variants.pageInfo;
  await assert.rejects(findFeeVariant(15,async()=>data),/incomplete catalogue/);
  assert.equal((await findFeeVariant(15,async()=>batch([]))).match,null);
});
