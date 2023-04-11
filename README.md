# Canvas to Notion Integration

This project allows for integration between a Canvas calendar and a Notion database. It makes it easy to import assignments into your notion assignment database 

## WARNING: This code was developed for use with a specific Notion page and may require some coding knowledge to debug if you encounter issues. 

## Getting Started

### Prerequisites

To use this, you will need:

- A Canvas account with the calendar url
- A Notion account with a database of assignments
- A Notion API key

### Installation

1. Clone the repository:

`git clone https://github.com/S1monlol/notionCanvas.git`  


2. Navigate to the project directory and install the dependencies:  
`cd notionCanvas`  
`npm install`

3. Create a `.env` file in the root of the project and add the following variables:

```
NOTION_API_KEY=<your-notion-api-key>  
NOTION_DATABASE_ID=<your-notion-database-id>
CANVAS_CALENDAR_URL=<your-canvas-calendar-url>
```

<details>
  <summary>How to get notion database ID</summary>
  Enter the page that contains the Database.  
  Check the title of the Database and click the "Expand to Full screen" icon, which looks like a two-way arrow.  
  Check the URL structure. It will look like https://www.notion.so/example123?v=example123  
  Copy the alphanumeric characters in the URL between notion.so/ and ?. This is your database ID.  
</details>


### Usage

To run the integration, use the following command:  
`npm start`  

To delete all entries from the Notion database, use the following command:
`npm start reset 


## Customization

To customize the project for your specific use case, you can edit the following files:

- `classes.js`: Edit this file to include your own classes and their corresponding IDs.
- `initElement`: If an error acures, edit this function from `app.js` to specify which fields to extract from the Canvas calendar and how to map them to the Notion database properties.

 
## License  
[MIT](https://choosealicense.com/licenses/mit/)  
