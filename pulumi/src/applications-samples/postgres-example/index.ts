import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { TauApplication } from "../../constructs/tauApplication";

export class PostgresExample extends TauApplication {
  constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
    super(
      name,
      {
        database: {
          name: "example-db",
          extensions: ["uuid-ossp", "pgcrypto"],
        },
      },
      opts
    );

    // Create a simple web application that connects to PostgreSQL
    const deployment = new k8s.apps.v1.Deployment(
      `${name}-deployment`,
      {
        spec: {
          replicas: 1,
          selector: { matchLabels: this.labels },
          template: {
            metadata: { labels: this.labels },
            spec: {
              containers: [
                {
                  name: "app",
                  image: "postgres:15-alpine", // Simple psql client for testing
                  command: [
                    "sh",
                    "-c",
                    `
                echo "PostgreSQL Example Application Started"
                echo "Database connection details:"
                echo "Host: $DB_HOST"
                echo "Port: $DB_PORT"
                echo "Database: $DB_NAME"
                echo "User: $DB_USER"
                echo "Connection URL: $DATABASE_URL"
                echo ""
                echo "Testing connection..."
                
                # Wait for database to be ready
                until pg_isready -h $DB_HOST -p $DB_PORT -U $DB_USER; do
                  echo "Waiting for database..."
                  sleep 2
                done
                
                echo "Database is ready!"
                echo "Creating test table and inserting data..."
                
                # Create a test table and insert some data
                PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "
                  CREATE TABLE IF NOT EXISTS test_table (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(100),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                  );
                  INSERT INTO test_table (name) VALUES ('Test Entry ' || EXTRACT(EPOCH FROM NOW()));
                  SELECT COUNT(*) as total_records FROM test_table;
                "
                
                echo "Database test completed successfully!"
                echo "Keeping container running for inspection..."
                
                # Keep container running
                while true; do
                  echo "Application is running. Database records:"
                  PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "SELECT COUNT(*) as total_records FROM test_table;" 2>/dev/null || echo "Database connection failed"
                  sleep 60
                done
                `,
                  ],
                  env: this.getAllEnvironmentVariables(),
                  resources: {
                    requests: { cpu: "50m", memory: "64Mi" },
                    limits: { cpu: "100m", memory: "128Mi" },
                  },
                },
              ],
            },
          },
        },
      },
      { parent: this }
    );

    // Create a simple service for the example (though it doesn't serve HTTP)
    const service = new k8s.core.v1.Service(
      `${name}-service`,
      {
        spec: {
          type: "ClusterIP",
          ports: [{ port: 8080, targetPort: 8080, protocol: "TCP" }],
          selector: this.labels,
        },
      },
      { parent: this }
    );
  }
}
