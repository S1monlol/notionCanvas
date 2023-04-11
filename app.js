const { Client } = require("@notionhq/client");
const ical = require("ical.js");
const { classes } = require("./classes.js");


require('dotenv').config();

// Initialize a new Notion client
const notion = new Client({ auth: process.env.NOTION_API_KEY });

// Specify the ID of the database you want to add an element to
const databaseId = process.env.NOTION_DATABASE_ID;

const calendarUrl = process.env.CANVAS_CALENDAR_URL;

getClassId = (sum) => {

    for (let classItem of classes) {
        if (typeof sum === 'string' && sum.includes(classItem.name)) {
            // console.log("Class found, ", classItem.name, classItem.id)
            return classItem.id
        }
    }

    return 404

}

initElement = async (calendar, i) => {

    let sum = (calendar[2][i][1][6][3])

    let id = getClassId(sum)

    if (id == 404) {
        // console.log("Class id not found")
        return "Class Not Found"
    }

    let doDate = calendar[2][i][1][2][3]
    let link = calendar[2][i][1][7][3]

    let shortName = sum.slice(0, sum.indexOf("[")).trim();

    // console.log("Do date : ", doDate)
    // console.log("Sum : ", sum)
    // console.log("Id: ", id)


    // Specify the properties for the new element
    const newElement = {
        Name: {
            title: [
                {
                    text: {
                        content: sum,
                    },
                },
            ],
        },
        Class: {
            relation: [
                {
                    id: id,
                },
            ],
        },
        Deadline: {
            date: {
                start: new Date(doDate)
            },
        },
        Link: {
            rich_text: [
                {
                    text: {
                        content: shortName, link: {
                            url: link
                        }
                    },
                    annotations: {
                        bold: false,
                        italic: false,
                        strikethrough: false,
                        underline: false,
                        code: false,
                        color: 'default'
                    },
                    plain_text: shortName,
                    href: link
                }
            ]
}

    };

return newElement
}

// Add the new element to the database
async function addElementToDatabase(databaseId, newElement) {

    try {
        const response = await notion.pages.create({
            parent: {
                database_id: databaseId,
            },
            properties: newElement,
        });
        console.log(`New element added: ${newElement.Name.title[0].text.content}`);
    } catch (error) {
        console.error(error.body);
    }
}
async function getPrevAssignments() {
    try {
        const response = await notion.databases.query({
            database_id: databaseId,
        });
        console.log(`Retrieved ${response.results.length} current assignments`);
        let prevAssignments = []
        for (let assignment of response.results) {

            if (assignment.properties.Name.title[0]?.plain_text) {
                prevAssignments.push(assignment.properties.Name.title[0]?.plain_text)
            }
        }
        return prevAssignments
    } catch (error) {
        console.error(error);
    }
}

let main = async () => {
    // get assignments from calendarUrl 
    const response = await fetch(calendarUrl);
    const calendarData = await response.text();

    // Parse the calendar data using ical.js
    const calendar = ical.parse(calendarData);

    let prevAssignments = await getPrevAssignments()

    for (let i = 0; i < calendar[2].length; i++) {
        let element = await initElement(calendar, i)

        if (element == "Class Not Found") {
            continue
        }

        // check if the current element has already been added from the list of prevAssignments
        if (prevAssignments.includes(element.Name.title[0].text.content)) {
            console.log("Already added", element.Name.title[0].text.content)
            continue
        }
        addElementToDatabase(databaseId, element);
    }

}

let deleteAll = async () => {
    const response = await notion.databases.query({
        database_id: databaseId,
    });
    const entries = response.results;
    for (const entry of entries) {
        await notion.pages.update({
            page_id: entry.id,
            properties: {
                // Set all properties to null to remove the entry
            },
            archived: true, // Archive the page to move it to the trash
        });
    }
}

switch (process.argv[2]) {
    case 'deleteAll':
    case 'delete':
    case 'reset':
        deleteAll();
        break;
    default:
        main();
        break;
}