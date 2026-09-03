use std::collections::{HashMap, HashSet};
use serde::{Deserialize, Serialize};

use super::ident::{Ident, ModuleName};
use super::expr::Bind;
use super::types::ExprType;

// E.g., 
// {
//   "line": 1,
//   "column": 2
// }
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SourcePos {
    pub line: i32,
    pub column: i32,
}

// E.g., 
// {
//   "path": "/path/to/file.purs",
//   "start": { "line": 1, "column": 1 },
//   "end": { "line": 2, "column": 1 }
// }
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SourceSpan {
    pub path: String,
    pub start: SourcePos,
    pub end: SourcePos,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleDto<A> {
    #[serde(rename = "moduleName")]
    pub name: ModuleName,
    #[serde(rename = "modulePath")]
    pub path: String,
    #[serde(rename = "sourceSpan")]
    pub span: SourceSpan,
    #[serde(default, rename = "typeTable")]
    pub type_table: Vec<ExprType>,
    #[serde(default)]
    pub imports: Vec<Import<A>>,
    #[serde(default)]
    pub exports: Vec<Ident>,
    #[serde(default, rename = "reExports")]
    pub re_exports: HashMap<String, Vec<Ident>>,
    #[serde(default)]
    pub foreign: Vec<Ident>,
    #[serde(default, rename = "foreignAnnotations")]
    pub foreign_annotations: HashMap<String, ForeignAnnotation>,
    #[serde(default)]
    pub decls: Vec<Bind<A>>,
    #[serde(default, rename = "dataDecls")]
    pub data_decls: Vec<DataDeclDto>,
    #[serde(default, rename = "classDecls")]
    pub class_decls: Vec<ClassDeclDto>,
    #[serde(default)]
    pub comments: Vec<Comment>,
}

// E.g., 
// {
//   "constructorName": "Just",
//   "fieldTypes": [1, 2]
// }
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataConstructorDto {
    #[serde(alias = "constructorName")]
    pub name: String,
    #[serde(alias = "fieldTypes", default)]
    pub fields: Vec<usize>,
}

// E.g., 
// {
//   "typeName": "Maybe",
//   "typeVars": ["a"],
//   "constructors": [
//     { "constructorName": "Nothing", "fieldTypes": [] },
//     { "constructorName": "Just", "fieldTypes": [1] }
//   ]
// }
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataDeclDto {
    #[serde(alias = "typeName")]
    pub name: String,
    #[serde(alias = "typeVars", default)]
    pub vars: Vec<String>,
    #[serde(default)]
    pub constructors: Vec<DataConstructorDto>,
}

// E.g., 
// {
//   "fqn": ["Data", "Eq", "Eq"],
//   "args": [1]
// }
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConstraintDto {
    pub fqn: Vec<String>,
    pub args: Vec<usize>,
}

// E.g., 
// {
//   "name": "eq",
//   "type": 42
// }
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MethodDto {
    pub name: String,
    #[serde(rename = "type")]
    pub type_info: usize,
}

// E.g., 
// {
//   "name": "Eq",
//   "vars": ["a"],
//   "superclasses": [],
//   "methods": [
//     { "name": "eq", "type": 42 }
//   ]
// }
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassDeclDto {
    pub name: String,
    #[serde(default)]
    pub vars: Vec<String>,
    #[serde(default)]
    pub superclasses: Vec<ConstraintDto>,
    #[serde(default)]
    pub methods: Vec<MethodDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DataConstructor {
    pub name: String,
    pub fields: Vec<ExprType>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DataDecl {
    pub name: String,
    pub vars: Vec<String>,
    pub constructors: Vec<DataConstructor>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ClassDecl {
    pub name: String,
    pub vars: Vec<String>,
    pub superclasses: Vec<(Vec<String>, Vec<ExprType>)>,
    pub methods: HashMap<String, ExprType>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Module<A> {
    pub name: ModuleName,
    pub path: String,
    pub span: SourceSpan,
    pub imports: Vec<Import<A>>,
    pub exports: HashSet<Ident>,
    pub re_exports: HashMap<ModuleName, Vec<Ident>>,
    pub data_decls: HashMap<String, DataDecl>,
    pub class_decls: HashMap<String, ClassDecl>,
    pub decls: Vec<Bind<A>>,
    pub foreign: HashMap<Ident, Option<ExprType>>,
    pub comments: Vec<Comment>,
}

impl<A> From<ModuleDto<A>> for Module<A> {
    fn from(dto: ModuleDto<A>) -> Self {
        // Convert string keys to ModuleName for re_exports
        let mut re_exports = HashMap::new();
        for (mod_name_str, idents) in dto.re_exports {
            let parts: Vec<String> = mod_name_str.split('.').map(|s| s.to_string()).collect();
            re_exports.insert(ModuleName(parts), idents);
        }

        // Merge foreign and foreign_annotations
        let mut foreign = HashMap::new();
        for f_ident in dto.foreign {
            let ann = dto.foreign_annotations.get(&f_ident.0).and_then(|a| a.type_info.clone());
            foreign.insert(f_ident, ann);
        }

        // Helper to resolve type indices
        let resolve_type = |idx: usize| -> ExprType {
            dto.type_table.get(idx).cloned().unwrap_or(ExprType::Any)
        };

        // Convert data_decls to HashMap for O(1) lookups
        let mut data_decls = HashMap::new();
        for decl in dto.data_decls {
            let constructors = decl.constructors.into_iter().map(|c| DataConstructor {
                name: c.name,
                fields: c.fields.into_iter().map(resolve_type).collect(),
            }).collect();
            
            let domain_decl = DataDecl {
                name: decl.name.clone(),
                vars: decl.vars,
                constructors,
            };
            data_decls.insert(domain_decl.name.clone(), domain_decl);
        }

        // Convert class_decls to HashMap for O(1) lookups
        let mut class_decls = HashMap::new();
        for decl in dto.class_decls {
            let superclasses = decl.superclasses.into_iter().map(|c| {
                (c.fqn, c.args.into_iter().map(resolve_type).collect())
            }).collect();
            
            let methods = decl.methods.into_iter().map(|m| {
                (m.name, resolve_type(m.type_info))
            }).collect();

            let domain_decl = ClassDecl {
                name: decl.name.clone(),
                vars: decl.vars,
                superclasses,
                methods,
            };
            class_decls.insert(domain_decl.name.clone(), domain_decl);
        }

        Self {
            name: dto.name,
            path: dto.path,
            span: dto.span,
            imports: dto.imports,
            exports: dto.exports.into_iter().collect(),
            re_exports,
            data_decls,
            class_decls,
            decls: dto.decls,
            foreign,
            comments: dto.comments,
        }
    }
}

// E.g., 
// {
//   "annotation": { "line": 1, "column": 1 },
//   "moduleName": ["Data", "Maybe"]
// }
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Import<A> {
    pub annotation: A,
    pub module_name: ModuleName,
}

// E.g., 
// {
//   "type": { "type": "TypeConstructor", "annotation": null, "constructor": ["Prim", "String"] }
// }
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignAnnotation {
    #[serde(rename = "type")]
    pub type_info: Option<ExprType>,
}

// Example JSON:
// "A single string for comment"
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Comment {
    LineComment(String),
    BlockComment(String),
}
