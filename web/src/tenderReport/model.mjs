// All numeric inputs here are canonical numbers, never locale-formatted text.
export const reportColumns = ['STT','Tên sp','Thành phần','Hàm lượng','SĐK','Công ty đăng ký','Dạng dùng','Dạng bào chế','Nhóm','Số sp','NSX','Nước','Số lượng','Đơn giá','Thành tiền']
export const blockColors = ['FFFFFF','F0F9FF','ECFDF5','FFFBEB','FAF5FF']
export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase().replace(/\s+/g,' ').trim()
const numeric = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)
const sum = values => values.some(value => value == null) ? null : values.reduce((total,value)=>total+value,0)
const minimum = values => { const valid=values.filter(value=>value!=null && value>=0); return valid.length?Math.min(...valid):null }
const strengthKey=value=>normalize(value).replace(/\s/g,'').replace(/,/g,'.')
// VSS/DAV record both spellings for Lacidipin and sometimes put its dose in INN.
const ingredientName=value=>String(value||'').replace(/\s+\d+(?:[.,]\d+)?\s*(?:mg|mcg|g)\s*$/i,'').replace(/\blacidipine\b/gi,'Lacidipin').trim()

export function buildReport(items, query, index=0) {
  const groups=new Map(), seen=new Set()
  for(const item of items){
    if(query.strength && strengthKey(item.strength)!==strengthKey(query.strength))continue
    if(query.form && normalize(item.dosageForm)!==normalize(query.form))continue
    const combination=/[+;]|(?<!\d),(?!\d)/.test(String(item.activeIngredient).replace(/\([^()]*\)/g,''))
    if(query.composition==='single' && combination || query.composition==='combination' && !combination)continue
    if(seen.has(item.id))continue
    seen.add(item.id)
    const ingredient=ingredientName(item.activeIngredient)
    const key=JSON.stringify([normalize(ingredient),strengthKey(item.strength),... [item.route,item.dosageForm,item.group,item.unit].map(normalize)])
    if(!groups.has(key))groups.set(key,{id:key,ingredient,strength:item.strength,route:item.route,dosageForm:item.dosageForm,group:item.group,unit:item.unit,products:new Map()})
    const group=groups.get(key)
    // One registration is one product even if VSS spells its maker differently.
    const productKey=item.regNumber?normalize(item.regNumber):JSON.stringify([item.brandName,item.manufacturer].map(normalize))
    if(!group.products.has(productKey))group.products.set(productKey,{...item,id:productKey,lines:[],packages:[]})
    const product=group.products.get(productKey)
    const quantity=numeric(item.quantity),unitPrice=numeric(item.unitPrice)
    product.lines.push({quantity,unitPrice,totalAmount:numeric(item.totalAmount) ?? (quantity!=null && unitPrice!=null?quantity*unitPrice:null)})
    product.packages.push({id:item.id,brandName:item.brandName,regNumber:item.regNumber,unit:item.unit,totalAmount:product.lines[product.lines.length-1].totalAmount,procurementCode:item.procurementCode||'',hospitalName:item.hospitalName||'',province:item.province||'',quantity,unitPrice,bidGroup:item.group,winDate:item.date||'',dateBasis:item.dateBasis||'Ngày bắt đầu HĐ'})
    for(const field of ['registrationCompany','manufacturer','country'])if(normalize(product[field])!==normalize(item[field]))product[field]=''
  }
  const rows=[...groups.values()].map(({products,...group})=>{
    const children=[...products.values()].map(({lines,...product})=>({...product,quantity:sum(lines.map(line=>line.quantity)),unitPrice:minimum(lines.map(line=>line.unitPrice)),totalAmount:sum(lines.map(line=>line.totalAmount))})).sort((a,b)=>a.brandName.localeCompare(b.brandName,'vi'))
    return {...group,productCount:children.length,totalQuantity:sum(children.map(p=>p.quantity)),minUnitPrice:minimum(children.map(p=>p.unitPrice)),totalAmount:sum(children.map(p=>p.totalAmount)),children,singleProduct:children.length===1?children[0]:undefined}
  }).sort((a,b)=>a.ingredient.localeCompare(b.ingredient,'vi')||a.strength.localeCompare(b.strength,'vi',{numeric:true})||a.route.localeCompare(b.route,'vi')||a.dosageForm.localeCompare(b.dosageForm,'vi')||String(a.group).localeCompare(String(b.group),'vi',{numeric:true}))
  return {blockId:JSON.stringify(query),queryKeyword:query.keyword,query:{...query},excelBgHex:blockColors[index%blockColors.length],rows,lineCount:seen.size,totalAmount:sum(rows.map(row=>row.totalAmount))}
}

export function rowValues(row, product, stt, child=false){
  return [child?'':stt,product?`${child?'↳ ':''}${product.brandName}`:'',row.ingredient,row.strength,product?.regNumber||'',product?.registrationCompany||'',row.route,row.dosageForm,row.group,child?'':row.productCount,product?.manufacturer||'',product?.country||'',product?product.quantity:row.totalQuantity,product?product.unitPrice:row.minUnitPrice,product?product.totalAmount:row.totalAmount]
}

export function reportHistory(block,regNumber,unit,groupRow){
  const packages=new Map()
  for(const row of groupRow?[groupRow]:block.rows)for(const product of row.children)if(groupRow || normalize(product.regNumber)===normalize(regNumber) && (!unit || normalize(product.unit)===normalize(unit)))for(const item of product.packages)packages.set(item.id,item)
  return [...packages.values()].sort((a,b)=>b.winDate.localeCompare(a.winDate))
}
