const XLSX = require('xlsx');
const path = require('path');

function getEmployees() {
  // __dirname (언더바 2개입니다)
  const filePath = path.join(__dirname, '../employees.xlsx');
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet);
}

function findEmployee(keyword) {
  const employees = getEmployees();
  return employees.filter(emp => 
    emp.사원명.includes(keyword) || emp.사번.includes(keyword) || emp.부서명.includes(keyword)
  );
}

module.exports = { getEmployees, findEmployee };