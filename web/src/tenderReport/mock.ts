import type { TenderProductDetail } from './types'
// Synthetic inputs for manual UI checks; never used by the production module.
export const mockTenderProducts:Array<Omit<TenderProductDetail,'packages'> & {date:string}>=[
  {id:'demo-1',brandName:'Thuốc mẫu A',activeIngredient:'Lacidipin',strength:'2mg',regNumber:'DEMO-A',registrationCompany:'Công ty mẫu A',route:'Uống',dosageForm:'Viên nén',group:'2',manufacturer:'NSX mẫu A',country:'Việt Nam',unit:'Viên',quantity:100,unitPrice:4000,totalAmount:400000,date:'2026-09-01'},
  {id:'demo-2',brandName:'Thuốc mẫu B',activeIngredient:'Lacidipin',strength:'2 mg',regNumber:'DEMO-B',registrationCompany:'Công ty mẫu B',route:'Uống',dosageForm:'Viên nén',group:'2',manufacturer:'NSX mẫu B',country:'Việt Nam',unit:'Viên',quantity:200,unitPrice:3000,totalAmount:600000,date:'2026-09-02'},
  {id:'demo-3',brandName:'Thuốc mẫu phối hợp',activeIngredient:'Lisinopril + Hydrochlorothiazide',strength:'10mg + 12.5mg',regNumber:'DEMO-C',registrationCompany:'Công ty mẫu C',route:'Uống',dosageForm:'Viên nén',group:'4',manufacturer:'NSX mẫu C',country:'Việt Nam',unit:'Viên',quantity:300,unitPrice:2000,totalAmount:600000,date:'2026-09-03'},
]
