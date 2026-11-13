const text = (maxLength=500) => ({type:'string',maxLength});
const enumeration = (values: string[]) => ({type:'string',enum:values});
const array = (item: unknown, maxItems=100) => ({type:'array',items:item,maxItems,uniqueItems:true});
export const object = (properties: Record<string, unknown>, required: string[]=[]) => ({type:'object',properties,required,additionalProperties:false});
const actions=['online_order','pickup_order','pickup_reservation','store_only','unknown'];
export const criteriaSchema = object({
  sellerPolicy:enumeration(['direct_only','all']),allowedSellers:array(text()),excludedSellers:array(text()),
  condition:enumeration(['new','any']),variant:text(),currency:{type:'string',pattern:'^[A-Z]{3}$'},
  maxPriceMinor:{anyOf:[{type:'null'},{type:'integer',minimum:0,maximum:1_000_000_000_000}]},
  priceBasis:enumeration(['item','delivered']),actions:array(enumeration(actions),5),storeIds:array(text()),
  notifyInitial:{type:'boolean'},confirmation:enumeration(['two_checks','one_check']),
});
export const regionSchema = object({country:{type:'string',pattern:'^[A-Z]{2}$'},locale:{type:'string',pattern:'^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8}){0,3}$'},currency:{type:'string',pattern:'^[A-Z]{3}$'},postalCode:text(30)});
export const ruleSchema = object({
  scopeSelector:text(),stockSelector:text(),availableText:text(),unavailableText:text(),priceSelector:text(),
  purchaseSelector:text(),sellerSelector:text(),directSeller:text(),confirmedSellerType:enumeration(['direct','marketplace','unknown']),
  confirmedCondition:enumeration(['new','used','refurbished','unknown']),confirmedAction:enumeration(actions),variant:text(),storeId:text(),
});
export const sourceFields={
  name:{type:'string',minLength:1,maxLength:160},url:{type:'string',minLength:8,maxLength:4096},
  method:enumeration(['auto','http','browser']),region:regionSchema,rule:ruleSchema,
  criteria:{anyOf:[criteriaSchema,{type:'null'}]},intervalSeconds:{type:'integer',minimum:60,maximum:86400},
};
export const sourceCreate=object(sourceFields,['name','url']);
export const sourcePatch=object({...sourceFields,revision:{type:'integer',minimum:1}},['revision']);
export const analyzeSchema=object({url:sourceFields.url,method:sourceFields.method,region:regionSchema,rule:ruleSchema,criteria:criteriaSchema},['url']);
export const productFields={name:{type:'string',minLength:1,maxLength:160},criteria:criteriaSchema,archived:{type:'boolean'}};
export const idParams=object({id:{type:'string',minLength:1,maxLength:100}},['id']);
