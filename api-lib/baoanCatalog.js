import products from './baoan_products.json' with { type: 'json' }

export function baoanProducts() {
  return Array.isArray(products) ? products : []
}

export function baoanCatalogItems() {
  return baoanProducts().map((item) => ({
    id: item.id,
    brand: item.brand_name || '',
    inn: item.inn || '',
    strength: item.strength || '',
    form: item.dosage_form || '',
    route: item.route || '',
    reg: item.reg_number || '',
    manufacturer: item.manufacturer || '',
  }))
}
