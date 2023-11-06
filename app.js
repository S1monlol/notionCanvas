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

    let date = new Date(doDate).toLocaleDateString();


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
                start: new Date(date)
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

fixDate = async (element, prevAssignments, curDate) => {
    // if the assignment has the same name but a different date, update the date
    if (prevAssignments.includes(element.Name.title[0].text.content)) {
        let oldDate = prevAssignments[prevAssignments.indexOf(element.Name.title[0].text.content) + 1]

        oldDate = new Date(oldDate).toLocaleDateString();

        if (oldDate != curDate) {
            // change date with filter
            const response = await notion.databases.query({
                database_id: databaseId,
            });
            for (const assignment of response.results) {
                if (assignment.properties.Name.title[0]?.plain_text == element.Name.title[0].text.content) {

                    // check if old date is the same as the new date

                    const response = await notion.pages.update({
                        page_id: assignment.id,
                        properties: {
                            Deadline: {
                                date: {
                                    start: new Date(curDate)
                                }
                            }
                        }
                    });
                    // console.log(`Updated date for ${element.Name.title[0].text.content}`);
                }
            }
        }
    }
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

        while(response.has_more) {
            const nextResponse = await notion.databases.query({
                database_id: databaseId,
                start_cursor: response.next_cursor,
            });
            response.results.push(...nextResponse.results);
            response.has_more = nextResponse.has_more;
            response.next_cursor = nextResponse.next_cursor;
        }
        
        console.log(`Retrieved ${response.results.length} current assignments`);
        const prevAssignments = [];
        for (const assignment of response.results) {
            const classId = assignment.properties.Class.relation[0]?.id;
            if (classId && classes.some(c => c.id === classId)) {
                const assignmentName = assignment.properties.Name.title[0]?.plain_text;
                if (assignmentName) {
                    prevAssignments.push(assignmentName);
                }
                // add date
                // const assignmentDate = assignment.properties.Deadline.date.start;
                // if (assignmentDate) {
                //     prevAssignments.push(assignmentDate);
                // }

            }
        }
        return prevAssignments;
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

        // remove the Z and replace with +00:00
        let curDate = element.Deadline.date.start;
        curDate = new Date(curDate).toLocaleString("en-US", { timeZone: "America/New_York" });

        let [month, day, year] = curDate.split("/");
        day = parseInt(day) + 1;

        // Create new date object and format it back into a string
        let nextDate = new Date(`${month}/${day}/${year}`);
        curDate = nextDate.toLocaleDateString("en-US", { timeZone: "America/New_York" });




        // check if the current element has already been added from the list of prevAssignments & if the assignment has the same date, if it doesnt have the same date, update it
        // if (prevAssignments.includes(element.Name.title[0].text.content )) {
        if (prevAssignments.includes(element.Name.title[0].text.content)) {
            // console.log("Already added", element.Name.title[0].text.content, curDate)
            fixDate(element, prevAssignments, curDate)
            continue
        }

        // console.log(element.Name.title[0].text.content, " not in ", prevAssignments)
        addElementToDatabase(databaseId, element);
    }

}

let deleteAll = async () => {
    const response = await notion.databases.query({
        database_id: databaseId,
    });

    const entries = response.results;
    for (const entry of entries) {
        console.log(entry.properties.Class.relation[0])

        if (classes.some(c => c.id === entry.properties.Class.relation[0]?.id)) {
            await notion.pages.update({
                page_id: entry.id,
                properties: {
                    // Set all properties to null to remove the entry
                },
                archived: true, // Archive the page to move it to the trash
            });
        }
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