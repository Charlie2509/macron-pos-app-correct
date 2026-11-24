import test from 'node:test';
import assert from 'node:assert/strict';
import {saveSetting} from '../app/handover-setting.server.js';
import {readHandoverSetting, pilotShop} from '../extensions/macron-pos/src/handover-config.js';

function snapshot(field, shop = pilotShop) {
  return {data: {shop: {myshopifyDomain:shop}, currentAppInstallation: {id:'gid://shopify/AppInstallation/1', metafield:field}}};
}

test('an unset or explicitly off pilot remains on the existing till path', () => {
  assert.equal(readHandoverSetting(snapshot(null)).enabled, false);
  assert.equal(readHandoverSetting(snapshot({type:'boolean',value:'false',compareDigest:'a'})).enabled, false);
  assert.equal(readHandoverSetting(snapshot({type:'boolean',value:'true',compareDigest:'b'})).enabled, true);
  for (const invalid of [snapshot(null, 'another-store.myshopify.com'),{errors:[{message:'scope'}]},snapshot({value:'true'}),snapshot({type:'boolean',value:'yes'})]) {
    assert.equal(readHandoverSetting(invalid), null);
  }
});

test('pilot changes compare the value the member of staff actually saw and use the owning app installation', async () => {
  const writes=[];
  let field=null;
  const admin={graphql:async(_query,params) => {
    if (!params) return Response.json(snapshot(field));
    const [input]=params.variables.metafields;
    writes.push(input);
    return Response.json({data:{metafieldsSet:{metafields:[{value:input.value}],userErrors:[]}}});
  }};
  assert.deepEqual(await saveSetting(admin,new Map([['enabled','true']])), {saved:true});
  assert.equal(writes[0].compareDigest, null);
  assert.equal(writes[0].ownerId,'gid://shopify/AppInstallation/1');
  assert.equal(writes[0].value,'true');
  field={type:'boolean',value:'true',compareDigest:'new'};
  assert.ok((await saveSetting(admin,new Map([['enabled','false'],['digest','old']]))).error);
  assert.deepEqual(await saveSetting(admin,new Map([['enabled','true']])),{saved:true});
  assert.equal(writes.length,1);
  assert.deepEqual(await saveSetting(admin,new Map([['enabled','false'],['digest','new']])),{saved:true});
  assert.equal(writes[1].compareDigest,'new');
});
