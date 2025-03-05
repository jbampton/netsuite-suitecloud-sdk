/**
 * Example parsing parent-netsuite-1.0.0.json file
 * This file as a root for several different type of schemes references as "ref"
 * Since ajv has problems to read https this example will read the parent json file, find the
 * sub schemes and match the input json file to be validated against the proper schema
 */
import {readFileSync} from "fs";
import Ajv from "ajv";

const ajv = new Ajv({strict: false})
const UTF_8 = "utf8";

//folder where the json files to be validated are stored
const RESOURCES_PATH = "../resources/";

//Parent json schema
const PARENT_SCHEME_URL = "https://raw.githubusercontent.com/oracle/netsuite-suitecloud-sdk/refs/heads/feature/PDPDEVTOOL-6007-schemas_for_suitecloud_tools/packages/schemas/parent-netsuite-1.0.0.json";

/**
 * Reads the unique input parameter which is the json file which is going to validated
 */
function readInputParameters() {
	let input = process.argv.slice(2);
	if (input.length !== 1) {
		throw new Error("Missing input json file");
	} else {
		return input[0];
	}
}

/**
 * This method fetches an url
 * @param url to be read
 */
async function readHttpsJsonUrl(url) {
	return fetch(url, {signal: AbortSignal.timeout(5000)})
		.then(response => {
			if (!response.ok) {
				throw new Error('Network response was not ok');
			}
			return response.json();
		});
}

/**
 * This method reads a text file and converts it into a Json object
 * @param fileName
 */
const readJsonFile = (fileName)  => {
	return JSON.parse(readFileSync(RESOURCES_PATH + fileName, UTF_8));
}

/**
 * Since ajv has problems loading the https references we just will read
 * all of them manually and match the json objects against them.
 * the format is "$ref":"https://<url>.json#/properties/<jsonEntityIdentifier>"
 *
 */
function findAllRefs(jsonParentSchema) {

	const regexp = /\"\$ref\"\s*:\s*\"(https?:\/\/[\w\/\d_\.\-]+)#\/properties\/([\w\d_\.\-]+)\"/g;
	let urls = new Map();
	let text = JSON.stringify(jsonParentSchema)
	let match;

	while ((match = regexp.exec(text)) !== null) {
		urls.set(match[2], match[1])
	}
	return urls;
}

/**
 * find the type of the input json file, it is the first element name
 * @param jsonFile
 * @param availableTypes
 */
function getJsonFileType(jsonFile, availableTypes ) {
	let jsonTypeList = Object.getOwnPropertyNames(jsonFile).filter(prop => prop !== "$schema");
	if (jsonTypeList.length === 1 && typeof jsonTypeList[0] === "string") {
		return jsonTypeList[0];
	} else {
		availableTypes.keys()
		throw new Error("Wrong json file, no main entity: ");
	}
}

/**
 * Prepares the schema for validation. It reads the URL where it is located and deletes
 * the schema, since ajv does not work properly with https urls
 * @param urlFileSchema
 */
async function getValidateFunctionFromUrl(urlFileSchema) {
	let schema = await readHttpsJsonUrl(urlFileSchema);
	delete schema.$schema
	return ajv.compile(schema);
}

function main() {
	//Reads json file to be validated
	let filenameToValidate = readInputParameters();
	let jsonFile = readJsonFile(filenameToValidate);
	//Find the file type (first element)


	(async () => {
		//Reads the parent schema
		const jsonParentSchema = await readHttpsJsonUrl(PARENT_SCHEME_URL);
		//Reads the subschemes form the parent
		let subSchemes = findAllRefs(jsonParentSchema);

		//Finds the proper subscheme
		let jsonFileType = getJsonFileType(jsonFile, subSchemes);
		let urlFileTypeSchema = subSchemes.get(jsonFileType);

		if (urlFileTypeSchema !== undefined) {
			//read subscheme
			let schema = await readHttpsJsonUrl(urlFileTypeSchema);
			//ajv does not support https
			delete schema.$schema
			//prepare sub schema for validation
			const validate = ajv.compile(schema);
			delete jsonFile.$schema
			//Just validate
			const valid = validate(jsonFile);
			if (!valid) {
				console.error("Validation errors:", validate.errors);
				return;
			} else {
				console.log("The file is valid")
			}

		} else {
			console.log("Json object invalid: "+jsonFileType);
		}
	})()
}

main();
